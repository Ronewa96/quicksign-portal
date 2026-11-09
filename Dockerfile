# QuickSign: Node app + LibreOffice (layout-preserving conversion) + Python/pdf2docx (PDF -> Word).
# Works on both x86 and ARM servers (e.g. Oracle Cloud Ampere A1).
FROM node:22-bookworm-slim

# LibreOffice components and fonts that match Microsoft Office metrics (Calibri, Cambria, Arial, Times)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      python3 python3-venv \
      fonts-liberation fonts-dejavu fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

# pdf2docx in its own virtual environment
COPY server/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    PYTHON_PATH=/opt/venv/bin/python \
    SOFFICE_PATH=/usr/bin/soffice

EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
