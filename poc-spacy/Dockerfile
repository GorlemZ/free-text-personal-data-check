FROM ghcr.io/astral-sh/uv:0.12.7 AS uv
FROM python:3.11-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
COPY src ./src
COPY bench ./bench
RUN uv sync --frozen --no-dev && useradd --system --uid 10001 analyzer && chown -R analyzer:analyzer /app
USER analyzer
EXPOSE 8000
CMD ["/app/.venv/bin/free-text-check"]
