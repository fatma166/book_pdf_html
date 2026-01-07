محول PDF إلى HTML مع واجهة ويب محلية

الملف الموجود `convert_pdf_to_html.py` يحتوي المنطق لتحويل صفحات PDF إلى صفحات HTML قابلة للاختيار والنص.

تشغيل الواجهة:

1. ثبت المتطلبات (يفضّل بيئة افتراضية):

```powershell
python -m pip install -r requirements.txt
```

2. تأكد من تثبيت Poppler وTesseract وتحديث المسارات إن لزم.
   - Poppler: أضف مسار مجلد `bin` فيه أو مرِّره عبر `poppler_path` في `web_ui.py` عند الحاجة.
   - Tesseract: إذا لم يكن في PATH حدّث `pytesseract.pytesseract.tesseract_cmd` أو مرِّر `tesseract_cmd` عند الاستدعاء.

3. شغّل الخادم:

```powershell
python web_ui.py
```

4. افتح المتصفح على `http://127.0.0.1:5000/` وارفع ملف PDF.

ملاحظة: التحويل قد يستغرق وقتًا طويلًا للملفات الكبيرة. هذه نسخة مبسطة قابلة للتطوير (خيوط/مهام خلفية، تقدم، خيارات إعدادات).