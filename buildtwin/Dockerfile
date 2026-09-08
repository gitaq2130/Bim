FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
# 설치의 정본은 pyproject.toml 하나다 — 의존성 이름을 여기 두 번째로 적지 않는다.
# 폴백을 두지 않는다 — 실패를 삼키고 두 번째 설치를 잇는 셸 OR 도, 조용한 기본값도.
# 이 설치가 실패하면 빌드는 rc 0 으로 끝나지 않는다(ADR 0020 §2-1 항 1).
RUN pip install --no-cache-dir -e .
COPY . .
