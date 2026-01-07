from flask import Flask, request, redirect, url_for, render_template, send_from_directory, flash, send_file
import os
import zipfile
from werkzeug.utils import secure_filename
from convert_pdf_to_html import convert_pdf_to_html

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
OUT_BASE = os.path.join(os.getcwd(), 'converted')
ALLOWED_EXTENSIONS = {'pdf'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB
app.secret_key = 'change-me'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUT_BASE, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        flash('No file part')
        return redirect(url_for('index'))
    file = request.files['file']
    if file.filename == '':
        flash('No selected file')
        return redirect(url_for('index'))
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        saved_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(saved_path)
        # create output dir for this upload
        name_root = os.path.splitext(filename)[0]
        out_dir = os.path.join(OUT_BASE, name_root)
        # احذف مجلد الإخراج إذا كان موجوداً لتفادي تراكم الصفحات القديمة
        if os.path.exists(out_dir):
            import shutil
            shutil.rmtree(out_dir)
        os.makedirs(out_dir, exist_ok=True)
        try:
            # قراءة نطاق الصفحات من النموذج
            page_start = request.form.get('page_start', type=int)
            page_end = request.form.get('page_end', type=int)
            if not page_start or not page_end or page_start < 1 or page_end < page_start:
                flash('يرجى إدخال نطاق صفحات صحيح')
                return redirect(url_for('index'))
            print(f"[web_ui] page_start={page_start}, page_end={page_end}")
            convert_pdf_to_html(saved_path, out_dir, poppler_path=None, tesseract_cmd=None,
                                dpi=200, langs='ara+eng', min_conf=30, enable_table_detection=False,
                                process_start=page_start, process_end=page_end)
        except Exception as e:
            flash(f'Conversion failed: {e}')
            return redirect(url_for('index'))
        # بعد التحويل: أنشئ ملف zip لمجلد الكتاب
        zip_path = os.path.join(OUT_BASE, f"{name_root}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(out_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, out_dir)
                    zipf.write(file_path, arcname)
        return redirect(url_for('result', book=name_root))
    else:
        flash('Invalid file type')
        return redirect(url_for('index'))

@app.route('/download/<book>.zip')
def download_zip(book):
    zip_path = os.path.join(OUT_BASE, f"{book}.zip")
    if not os.path.isfile(zip_path):
        flash('الملف المضغوط غير موجود')
        return redirect(url_for('result', book=book))
    return send_file(zip_path, as_attachment=True)


@app.route('/result/<book>')
def result(book):
    out_dir = os.path.join(OUT_BASE, book)
    if not os.path.isdir(out_dir):
        flash('Result not found')
        return redirect(url_for('index'))
    files = sorted([f for f in os.listdir(out_dir) if f.endswith('.html')])
    return render_template('result.html', book=book, files=files)


@app.route('/converted/<book>/<path:filename>')
def serve_converted(book, filename):
    out_dir = os.path.join(OUT_BASE, book)
    return send_from_directory(out_dir, filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
