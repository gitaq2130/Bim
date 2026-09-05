FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e . psycopg[binary] || pip install --no-cache-dir fastapi "uvicorn[standard]" "sqlalchemy>=2" "pydantic>=2" pydantic-settings python-multipart "python-jose[cryptography]" "passlib[bcrypt]" pyyaml celery redis ortools numpy scipy shapely ifcopenshell ezdxf open3d laspy plyfile httpx "psycopg[binary]"
COPY . .
