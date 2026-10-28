# Imagem base oficial do Node.js LTS (Alpine - ultraleve e segura)
FROM node:20-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia arquivos de pacotes para otimizar cache de camadas
COPY package*.json ./

# Instala dependências de produção
RUN npm install --omit=dev

# Copia o restante do projeto
COPY . .

# Expõe a porta do servidor
EXPOSE 5173

# Variáveis de ambiente
ENV PORT=5173
ENV NODE_ENV=production

# Inicializa o servidor
CMD ["node", "server.js"]
