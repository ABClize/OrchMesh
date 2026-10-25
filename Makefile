.DEFAULT_GOAL := help
.PHONY: help setup dev run check test

help:
	@printf '%s\n' \
	  'make setup  安装锁定依赖、准备 .env、构建 Pi 镜像（首次/升级）' \
	  'make dev    启动前后端热更新；Ctrl+C 一起停止' \
	  'make run    构建页面并启动单服务；Ctrl+C 停止' \
	  'make check  Lint 与类型检查' \
	  'make test   构建并运行测试；ORCHMESH_TEST_DOCKER=1 可加测真实 Pi' \
	  '端口、初始账号和模型配置统一编辑根目录 .env。'

setup:
	uv sync --directory apps/server --locked
	npm --prefix apps/web ci
	@test -f .env || (umask 077; cp .env.example .env)
	uv run --directory apps/server orchmesh build-image

dev:
	uv run --directory apps/server orchmesh dev

run:
	npm --prefix apps/web run build
	uv run --directory apps/server orchmesh run

check:
	uv run --directory apps/server ruff check src tests
	uv run --directory apps/server ruff format --check src tests
	uv run --directory apps/server pyright src
	npm --prefix apps/web run lint
	npm --prefix apps/web run check
	npm --prefix apps/web run prettier -- --check src
	./scripts/check-api.sh

test:
	npm --prefix apps/web run build
	uv run --directory apps/server pytest -q
	npm --prefix apps/web test
