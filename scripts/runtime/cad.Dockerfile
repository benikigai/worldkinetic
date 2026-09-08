# Source-consistent packaging for the selected gate runtime; not a measured rebuild.
FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/runtime/cad-requirements.txt /tmp/cad-requirements.txt
RUN pip install --no-cache-dir -r /tmp/cad-requirements.txt && rm /tmp/cad-requirements.txt
USER 65532:65532
