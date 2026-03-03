FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend /app/backend
COPY results /app/results
WORKDIR /app/backend
ENV PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
