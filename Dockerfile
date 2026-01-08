FROM nikolaik/python-nodejs:python3.11-nodejs20

# تثبيت مكتبات النظام الضرورية (Tesseract و Poppler)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-ara \
    poppler-utils \
    ffmpeg \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# نسخ ملفات المتطلبات وتثبيت مكتبات Python
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# نسخ ملفات package.json وتثبيت مكتبات Node.js
COPY package*.json ./
RUN npm install

# نسخ باقي ملفات المشروع
COPY . .

# تحديد متغيرات البيئة
ENV PORT=3000
ENV PYTHONIOENCODING=utf-8

# أمر التشغيل
CMD ["node", "node_app.js"]