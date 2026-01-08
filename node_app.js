const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const port = 3000;

// إعداد مجلدات العمل
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');

// التأكد من وجود المجلدات
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CONVERTED_DIR)) fs.mkdirSync(CONVERTED_DIR, { recursive: true });

// إعداد Multer لرفع الملفات
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // تسمية الملف بوقت الرفع لتجنب التكرار
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // استبدال المسافات بشرطة سفلية لتجنب مشاكل الأسماء في سطر الأوامر
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage: storage });

// تقديم الملفات المحولة (HTML والصور) كملفات ثابتة ليتمكن المتصفح من عرضها
app.use('/converted', express.static(CONVERTED_DIR));

// الصفحة الرئيسية: نموذج الرفع
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Node.js PDF to HTML Converter</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            h1 { text-align: center; color: #333; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: bold; color: #555; }
            input[type="file"], input[type="number"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
            button { width: 100%; padding: 12px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; transition: background 0.3s; }
            button:hover { background-color: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>تحويل PDF إلى HTML (Node.js)</h1>
            <form action="/convert" method="post" enctype="multipart/form-data">
                <div class="form-group">
                    <label for="pdf">اختر ملف PDF:</label>
                    <input type="file" name="pdf" id="pdf" accept=".pdf" required>
                </div>
                <div class="form-group">
                    <label for="start">من صفحة:</label>
                    <input type="number" name="start" id="start" value="1" min="1" required>
                </div>
                <div class="form-group">
                    <label for="end">إلى صفحة (اختياري):</label>
                    <input type="number" name="end" id="end" min="1" placeholder="اتركه فارغاً لنهاية الملف">
                </div>
                <button type="submit">بدء التحويل</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

// مسار معالجة التحويل
app.post('/convert', upload.single('pdf'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('الرجاء رفع ملف PDF.');
    }

    const pdfPath = req.file.path;
    const startPage = req.body.start || 1;
    const endPage = req.body.end;

    // إنشاء مجلد خاص لهذا التحويل داخل converted بناءً على اسم الملف
    const jobName = path.parse(req.file.filename).name;
    const outDir = path.join(CONVERTED_DIR, jobName);

    // مسار سكربت البايثون
    const pythonScriptPath = path.join(__dirname, 'convert_pdf_to_html.py');

    // تجهيز المعاملات (Arguments) لتمريرها للبايثون
    const args = [
        pythonScriptPath,
        '--pdf_path', pdfPath,
        '--out_dir', outDir,
        '--start', startPage.toString()
    ];

    if (endPage) {
        args.push('--end', endPage.toString());
    }

    // تحديد أمر بايثون بناءً على نظام التشغيل (py للويندوز، python3 للينكس/ماك)
    const pythonCmd = process.platform === "win32" ? "py" : "python3";
    console.log(`Starting Python script: ${pythonCmd} ${args.join(' ')}`);

    // تشغيل عملية بايثون كعملية فرعية (Child Process)
    // نمرر PYTHONIOENCODING لتجنب مشاكل ترميز النصوص العربية في ويندوز
    const pythonProcess = spawn(pythonCmd, args, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    // معالجة خطأ عدم القدرة على تشغيل بايثون (مثلاً غير مثبت أو غير موجود في PATH)
    pythonProcess.on('error', (err) => {
        console.error('Failed to start subprocess:', err);
        if (!res.headersSent) {
            res.status(500).send(`<h1>فشل تشغيل Python</h1><p>الخطأ: ${err.message}</p><p>تأكد من تثبيت Python وإضافته لمتغيرات البيئة PATH.</p>`);
        }
    });

    // تجميع المخرجات (اختياري للـ Debugging)
    let scriptOutput = "";

    pythonProcess.stdout.on('data', (data) => {
        const txt = data.toString();
        console.log(`[Python]: ${txt.trim()}`);
        scriptOutput += txt;
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python Error]: ${data.toString()}`);
        scriptOutput += `ERROR: ${data.toString()}\n`;
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);

        if (res.headersSent) return;

        // حذف ملف الـ PDF المرفوع بعد الانتهاء لتوفير المساحة (اختياري)
        // fs.unlink(pdfPath, (err) => { if(err) console.error(err); });

        if (code === 0) {
            // ضغط الملفات الناتجة
            const zipName = `${jobName}.zip`;
            const zipPath = path.join(CONVERTED_DIR, zipName);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                // عند انتهاء الضغط، نعرض صفحة النتائج مع زر التحميل
                fs.readdir(outDir, (err, files) => {
                    if (err) return res.status(500).send("خطأ في قراءة المخرجات");

                    // فلترة ملفات HTML فقط وترتيبها
                    const htmlFiles = files.filter(f => f.endsWith('.html')).sort((a, b) => {
                        const numA = parseInt(a.match(/\d+/) || 0);
                        const numB = parseInt(b.match(/\d+/) || 0);
                        return numA - numB;
                    });

                    let links = htmlFiles.map(f => `<li><a href="/converted/${jobName}/${f}" target="_blank">${f}</a></li>`).join('');

                    res.send(`
                        <!DOCTYPE html>
                        <html lang="ar" dir="rtl">
                        <head><meta charset="UTF-8"><title>النتيجة</title></head>
                        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                            <h1 style="color: green;">تم التحويل بنجاح!</h1>

                            <div style="margin: 30px 0;">
                                <a href="/converted/${zipName}" style="display: inline-block; padding: 15px 30px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px; font-size: 20px; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">📥 تحميل الكل (ZIP)</a>
                            </div>

                            <div style="text-align: right; display: inline-block; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); max-width: 500px; width: 100%;">
                                <h3>معاينة الصفحات (${htmlFiles.length}):</h3>
                                <ul style="max-height: 200px; overflow-y: auto;">${links}</ul>
                            </div>
                            <br><br>
                            <a href="/" style="padding: 10px 20px; background: #333; color: white; text-decoration: none; border-radius: 5px;">تحويل ملف آخر</a>
                        </body>
                        </html>
                    `);
                });
            });

            archive.on('error', (err) => {
                console.error("Archiver error:", err);
                if (!res.headersSent) res.status(500).send("خطأ أثناء ضغط الملفات.");
            });

            archive.pipe(output);
            archive.directory(outDir, false); // ضغط محتويات المجلد دون إنشاء مجلد أب
            archive.finalize();
        } else {
            // فشل التحويل
            res.status(500).send(`
                <h1>حدث خطأ أثناء التحويل</h1>
                <p>كود الخروج: ${code}</p>
                <p>تأكد من تثبيت المكتبات اللازمة للبايثون (pdf2image, pytesseract, opencv-python).</p>
                <pre style="text-align: left; direction: ltr; background: #eee; padding: 10px; overflow: auto;">${scriptOutput}</pre>
                <a href="/">عودة</a>
            `);
        }
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});