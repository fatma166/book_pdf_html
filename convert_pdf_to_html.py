# ...existing code...
import os, html, sys, shutil, subprocess
from pdf2image import convert_from_path, pdfinfo_from_path, exceptions as pdf2image_exceptions
from PIL import Image
import pytesseract
from pytesseract import Output
import cv2
import numpy as np

# ====== تكوين ======
PDF_PATH = r"c:\test_gemini_ai\book.pdf"          # عدّل هنا
OUT_DIR = r"c:\test_gemini_ai\output"
POPPLER_PATH = r"C:\poppler\Library\bin"          # أو None إذا أضفت للـ PATH
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
DPI = 200
LANGS = "ara+eng"   # تأكد أن 'ara' مثبتة في tesseract
MIN_CONF = 30
# مؤقت: نطاق الصفحات الذي نطبّق عليه التحسينات أو ننفّذ التحويل (بافتراض 1-10 للتجربة)
PROCESS_START = 1
PROCESS_END = 10
# ...existing code...

def check_tesseract_has_lang(lang_code):
    try:
        proc = subprocess.run([pytesseract.pytesseract.tesseract_cmd, '--list-langs'],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        out = proc.stdout + proc.stderr
        return (lang_code in out.split())
    except Exception:
        return False

if not check_tesseract_has_lang('ara'):
    print("لم يتم العثور على موديل اللغة العربية (ara) في Tesseract.")
    print("ثبّت tessdata لـ Arabic أو حمّل نسخة UB-Mannheim وتأكد من وجود ara.traineddata.")
    print("راجع: https://github.com/tesseract-ocr/tessdata")
    sys.exit(1)

def preprocess_for_ocr(pil_img):
    # تحويل PIL -> OpenCV
    img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # زيادة الدقة إن كانت صغيرة
    h, w = gray.shape
    if w < 1200:
        scale = int(1200 / w)
        gray = cv2.resize(gray, (w*scale, h*scale), interpolation=cv2.INTER_CUBIC)
    # إزالة الضوضاء وتوضيح الحواف
    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    # ثَبت عتبة تكيفية مناسبة للخط العربي
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY, 31, 15)
    # فتح مغلق للتخلص من نقاط صغيرة
    kernel = np.ones((1,1), np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)
    # تصحيح الانحراف بالاعتماد على OSD
    try:
        osd = pytesseract.image_to_osd(th)
        rot = 0
        for line in osd.splitlines():
            if line.startswith("Rotate:"):
                rot = int(line.split(":")[1].strip())
                break
        if rot != 0:
            M = cv2.getRotationMatrix2D((th.shape[1]//2, th.shape[0]//2), -rot, 1.0)
            th = cv2.warpAffine(th, M, (th.shape[1], th.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        pass
    return th


def find_nontext_regions(binary_img, text_boxes, min_area=2000):
    # binary_img: single-channel binary (0/255) image used for analysis
    # text_boxes: list of (left,top,width,height)
    mask = np.zeros_like(binary_img)
    for (l, t, w, h) in text_boxes:
        cv2.rectangle(mask, (l, t), (l + w, t + h), 255, -1)
    # non-text regions are where mask==0
    non_text = cv2.bitwise_not(mask)
    # remove small noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5,5))
    non_text = cv2.morphologyEx(non_text, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(non_text, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    for cnt in contours:
        x,y,w,h = cv2.boundingRect(cnt)
        if w*h >= min_area:
            regions.append((x,y,w,h))
    return regions


def detect_table_regions(binary_img):
    # detect regions that look like tables by finding line structures
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40,1))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1,40))
    horiz = cv2.morphologyEx(binary_img, cv2.MORPH_OPEN, horiz_kernel)
    vert = cv2.morphologyEx(binary_img, cv2.MORPH_OPEN, vert_kernel)
    table_mask = cv2.bitwise_and(horiz, vert)
    # dilate a bit to merge close intersections
    table_mask = cv2.dilate(table_mask, np.ones((3,3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    for cnt in contours:
        x,y,w,h = cv2.boundingRect(cnt)
        if w*h > 1000:
            regions.append((x,y,w,h))
    return regions


def extract_table_html_from_region(pil_page, region_bbox, lang=LANGS):
    # Simple heuristic: OCR region, cluster words into rows by Y, then into columns by X
    x0,y0,w0,h0 = region_bbox
    region = pil_page.crop((x0, y0, x0+w0, y0+h0))
    region_np = cv2.cvtColor(np.array(region), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(region_np, cv2.COLOR_BGR2GRAY)
    data = pytesseract.image_to_data(gray, lang=lang, config='--oem 1 --psm 6', output_type=Output.DICT)
    items = []
    n = len(data.get('level', []))
    for i in range(n):
        text = (data['text'][i] or '').strip()
        if not text:
            continue
        l = int(data['left'][i]); t = int(data['top'][i]); w = int(data['width'][i]); h = int(data['height'][i])
        cx = l + w/2
        cy = t + h/2
        items.append({'text':html.escape(text),'l':l,'t':t,'w':w,'h':h,'cx':cx,'cy':cy})
    if not items:
        return ''
    # cluster into rows by cy
    items.sort(key=lambda it: it['cy'])
    rows = []
    row_thresh = max(10, int(h0*0.04))
    cur_row = [items[0]]
    for it in items[1:]:
        if abs(it['cy'] - cur_row[-1]['cy']) <= row_thresh:
            cur_row.append(it)
        else:
            rows.append(cur_row)
            cur_row = [it]
    if cur_row:
        rows.append(cur_row)
    # determine column boundaries by scanning x centers from first row
    first_row = sorted(rows[0], key=lambda it: it['cx'])
    cols = [it['cx'] for it in first_row]
    col_thresh = max(20, int(w0*0.05))
    # merge close columns
    merged = []
    for c in cols:
        if not merged or c - merged[-1] > col_thresh:
            merged.append(c)
    cols = merged
    # build HTML
    html_rows = []
    for r in rows:
        cells = ['' for _ in cols]
        for cell in r:
            # find nearest column
            dists = [abs(cell['cx'] - c) for c in cols]
            idx = int(np.argmin(dists))
            if cells[idx]:
                cells[idx] += ' ' + cell['text']
            else:
                cells[idx] = cell['text']
        td_html = ''.join(f'<td>{c or ""}</td>' for c in cells)
        html_rows.append(f'<tr>{td_html}</tr>')
    table_html = '<table border="1" style="border-collapse:collapse; width:100%;">' + ''.join(html_rows) + '</table>'
    # wrap table in positioned div relative to page
    style = f'position:absolute; left:{x0}px; top:{y0}px; width:{w0}px; height:{h0}px; overflow:auto;'
    return f'<div style="{style}">{table_html}</div>'

def resolve_poppler_path(provided):
    if provided and os.path.isdir(provided) and os.path.exists(os.path.join(provided, "pdfinfo.exe")):
        return provided
    exe = shutil.which("pdfinfo")
    if exe:
        return os.path.dirname(exe)
    return None

POPPLER_PATH = resolve_poppler_path(POPPLER_PATH)
if not POPPLER_PATH:
    print("لم أجد Poppler (pdfinfo). ثبّت Poppler وأضف مسار الـ bin للـ PATH أو حدّث POPPLER_PATH في الملف.")
    sys.exit(1)

os.makedirs(OUT_DIR, exist_ok=True)
IMG_DIR = os.path.join(OUT_DIR, "images")
os.makedirs(IMG_DIR, exist_ok=True)
# ...existing code...

# ====== احصل على عدد الصفحات ======
info = pdfinfo_from_path(PDF_PATH, userpw=None, poppler_path=POPPLER_PATH)
total_pages = int(info.get("Pages", 0))
if total_pages == 0:
    print("لم أتمكن من قراءة عدد الصفحات."); sys.exit(1)

print(f"عدد الصفحات: {total_pages}")

# ====== معالجة كل صفحة على حدة لتفادي استهلاك الذاكرة ======
for p in range(1, total_pages + 1):
    print(f"معالجة صفحة {p}/{total_pages}...")
    # نفّذ فقط على نطاق الصفحات المحدد حالياً للتجربة
    if p < PROCESS_START or p > PROCESS_END:
        print(f"تخطي صفحة {p} (خارج النطاق {PROCESS_START}-{PROCESS_END})")
        continue
    try:
        imgs = convert_from_path(PDF_PATH, dpi=DPI, first_page=p, last_page=p, poppler_path=POPPLER_PATH)
        if not imgs:
            print(f"تعذر تحويل الصفحة {p}")
            continue
        pil_img = imgs[0]
        img_name = f"page-{p}.png"
        img_path = os.path.join(IMG_DIR, img_name)
        pil_img.save(img_path, format="PNG")

        w, h = pil_img.size

        proc_img = preprocess_for_ocr(pil_img)

        # استخدم psm مناسب (6 أو 3) و oem 1 أو 3 حسب التثبيت
        config = r'--oem 1 --psm 6'
        data = pytesseract.image_to_data(proc_img, lang=LANGS, config=config, output_type=Output.DICT)

        spans = []
        n = len(data.get('level', []))
        any_text = False
        text_boxes = []
        # Group words by (block,par,line) to create a single selectable line element
        lines = {}
        for i in range(n):
            text = (data['text'][i] or "").strip()
            conf_raw = data['conf'][i]
            try:
                conf = int(float(conf_raw))
            except:
                conf = -1
            if not text or conf < MIN_CONF:
                continue
            any_text = True
            left = int(data['left'][i])
            top = int(data['top'][i])
            width = int(data['width'][i])
            height = int(data['height'][i])
            text_boxes.append((left, top, width, height))
            safe = html.escape(text)
            block = data.get('block_num', [None]*n)[i]
            par = data.get('par_num', [None]*n)[i]
            line = data.get('line_num', [None]*n)[i]
            key = (block, par, line)
            lines.setdefault(key, []).append({'text': safe, 'l': left, 't': top, 'w': width, 'h': height})

        # Build one absolute div per line; inside, absolutely-positioned spans sized to OCR bbox
        for key, items in lines.items():
            # compute bounding extents for container
            top = min(it['t'] for it in items)
            line_h = max(it['h'] for it in items)
            font_size = max(10, int(line_h * 0.8))
            base_left = min(it['l'] for it in items)
            max_right = max(it['l'] + it['w'] for it in items)
            line_width = max(1, int(max_right - base_left))

            # For correct text selection in RTL languages, emit DOM in visual order
            is_rtl = 'ara' in LANGS.lower() or 'arab' in LANGS.lower()
            ordered = sorted(items, key=lambda it: it['l'], reverse=is_rtl)

            inner_parts = []
            punct_chars = set('.,،;:!?؟)]}›»\"\'')
            for idx, it in enumerate(ordered):
                rel_left = int(it['l'] - base_left)
                # ensure span covers the full OCR bbox so hit-area matches image
                span_style = (
                    f"position:absolute; left:{rel_left}px; top:0px; width:{it['w']}px; height:{line_h}px; "
                    "white-space:nowrap; overflow:visible; display:inline-block; "
                    "user-select:text; -webkit-user-select:text; -moz-user-select:text; "
                    "pointer-events:auto;"
                )
                content = it['text']
                # add a preserved space before words except when the token starts with punctuation
                first_ch = content.lstrip()[:1]
                if idx > 0 and first_ch and first_ch not in punct_chars:
                    content = '&nbsp;' + content
                inner_parts.append(f'<span style="{span_style}">{content}</span>')

            inner = ''.join(inner_parts)

            # container is positioned where the line appears; allow selection and set RTL dir
            container_style = (
                f"position:absolute; left:{base_left}px; top:{top}px; width:{line_width}px; height:{line_h}px; "
                f"font-size:{font_size}px; line-height:{line_h}px; overflow:visible; "
                "font-family: 'Noto Naskh Arabic', 'Arial', sans-serif; direction:rtl; unicode-bidi:plaintext; "
                "color:#000; -webkit-text-fill-color:#000; text-shadow:none; "
                "user-select:text; -webkit-user-select:text; -moz-user-select:text; cursor:text; "
                "z-index:2; pointer-events:auto;"
            )
            spans.append(f'<div style="{container_style}">{inner}</div>')

        if not any_text:
            print(f"تحذير: لم يتعرف OCR على نص واضح في الصفحة {p}. جرّب رفع DPI أو تعديل MIN_CONF أو معاينة الصورة المعالجة.")
            # لحفظ صورة المعالجة لتفقدها يدوياً
            cv2.imwrite(os.path.join(IMG_DIR, f"proc-{p}.png"), proc_img)

        # اكتشاف الجداول ضمن الصورة المعالجة
        overlays = []
        try:
            table_regions = detect_table_regions(proc_img)
            for ridx, tb in enumerate(table_regions):
                thtml = extract_table_html_from_region(pil_img, tb, lang=LANGS)
                if thtml:
                    # ensure tables overlay above text but do not block selection (non-interactive)
                    overlays.append(thtml.replace('style="', 'style="z-index:3; pointer-events:none; '))
        except Exception:
            pass

        # اكتشاف صور غير نصية (رسومات، صور) وحفظها
        try:
            nontext = find_nontext_regions(proc_img, text_boxes, min_area=1500)
            for idx, (x,y,w2,h2) in enumerate(nontext):
                crop = pil_img.crop((x, y, x+w2, y+h2))
                fig_name = f'figure-p{p}-{idx}.png'
                fig_path = os.path.join(IMG_DIR, fig_name)
                crop.save(fig_path, format='PNG')
                # Make overlay images non-interactive so they don't block text selection
                style = f'position:absolute; left:{x}px; top:{y}px; width:{w2}px; height:{h2}px; z-index:3; pointer-events:none;'
                overlays.append(f'<img src="images/{fig_name}" style="{style}">')
        except Exception:
            pass

        # إذا تم استخراج نص واضح، نمنع تضمين صورة الخلفية لتفادي ظهور النص مرتين
        include_bg_image = True
        if any_text:
            include_bg_image = False

        # background image is faded when OCR text exists and does not block selection
        img_opacity = 0.18 if any_text else 1.0
        img_tag = f'<img src="images/{img_name}" style="position:absolute; left:0; top:0; width:{w}px; height:{h}px; opacity:{img_opacity}; z-index:1; pointer-events:none;">'

        html_content = f"""<!doctype html>
    <html lang="ar">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>صفحة {p}</title></head>
    <body style="margin:0;padding:0;">
    <div style="position:relative; width:{w}px; height:{h}px;">
    {img_tag}
    {''.join(overlays)}
    {''.join(spans)}
    </div>
    </body>
    </html>"""

        out_html = os.path.join(OUT_DIR, f"page-{p}.html")
        with open(out_html, "w", encoding="utf-8") as f:
            f.write(html_content)

    except Exception as e:
        print(f"خطأ في الصفحة {p}: {e}")

print("انتهى. النتائج في:", OUT_DIR)
# ...existing code...