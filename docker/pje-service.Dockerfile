# ==============================================================================
# STAGE 1: Build & Compilation
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copiar arquivos de dependências
COPY package*.json tsconfig.json ./

# Instalar dependências completas
RUN npm ci

# Copiar código-fonte
COPY src ./src

# Compilar TypeScript
RUN npm run build

# ==============================================================================
# STAGE 2: Production Release
# ==============================================================================
FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copiar package.json para resoluções de execução
COPY package*.json ./

# Instalar apenas dependências de produção para otimizar tamanho
RUN npm ci --only=production

# Copiar os artefatos compilados do builder
COPY --from=builder /usr/src/app/build ./build

# Criar diretórios locais de logs e certificados (não copiados na imagem)
RUN mkdir -p logs certs && \
    chown -R node:node /usr/src/app

# Executar como usuário não-root nativo do Alpine (node) por segurança
USER node

# Expor a porta do servidor Express/Fastify de controle e métricas
EXPOSE 3000

# Healthcheck que consulta o endpoint local de health e observabilidade
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(res => res.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Comando de inicialização do servidor
CMD ["node", "build/index.js"]
