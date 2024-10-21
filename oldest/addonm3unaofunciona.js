const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require('axios');
const net = require('net');

let cachedChannels = null;
let cachedCategories = null;
const CACHE_TTL = 3600000; // 1 hora em milissegundos
let lastCacheTime = 0;

const manifest = {
    id: "org.myiptvaddon",
    version: "1.0.0",
    name: "Meu Addon IPTV",
    description: "Addon IPTV personalizado",
    resources: ["catalog", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: 'tv',
            id: 'iptv_channels',
            name: '📺 Canais IPTV',
            extra: [
                {
                    name: "m3u_link",  // Campo para o usuário inserir o link M3U
                    isRequired: true,
                    options: [],  // Sem opções predefinidas, o usuário entra com seu link
                    optionsLimit: 200,
                },
                { name: "skip", isRequired: false }
            ]
        }
    ]
};

// Função para obter e processar a lista M3U do usuário
async function getIPTVList(m3uLink) {
    const now = Date.now();
    if (cachedChannels && (now - lastCacheTime < CACHE_TTL)) {
        console.log('Usando lista IPTV em cache');
        return cachedChannels;
    }

    try {
        console.log(`Obtendo lista IPTV do link: ${m3uLink}`);
        const response = await axios.get(m3uLink);
        console.log('Lista IPTV obtida com sucesso');
        cachedChannels = parseM3U(response.data);
        
        // Atualizar cache de categorias
        cachedCategories = [...new Set(cachedChannels.map(ch => ch.genre))]
            .filter(Boolean)
            .sort();
        
        lastCacheTime = now;
        return cachedChannels;
    } catch (error) {
        console.error('Erro ao obter a lista IPTV:', error);
        return [];
    }
}

// Função para analisar o conteúdo M3U
function parseM3U(m3uContent) {
    console.log('Analisando conteúdo M3U...');
    const channels = [];
    const lines = m3uContent.split('\n');
    let currentChannel = null;

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const matches = line.match(/tvg-logo="([^"]*)".*group-title="([^"]*)".*,(.+)/);
            if (matches) {
                currentChannel = {
                    name: matches[3].trim(),
                    logo: matches[1],
                    genre: matches[2].trim()
                };
            }
        } else if (line.trim().startsWith('http') && currentChannel) {
            currentChannel.url = line.trim();
            channels.push(currentChannel);
            currentChannel = null;
        }
    }

    console.log(`${channels.length} canais encontrados`);
    return channels;
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async function(args) {
    const m3uLink = args.extra.m3u_link;  // Recebe o link M3U do usuário
    if (!m3uLink) {
        console.log('Link M3U não fornecido');
        return { metas: [] };
    }

    const channels = await getIPTVList(m3uLink);
    let filteredChannels = channels;

    // Aplicar filtro de gênero, se houver
    if (args.extra.genre) {
        console.log('Filtrando por categoria:', args.extra.genre);
        filteredChannels = channels.filter(ch => ch.genre === args.extra.genre);
    }

    // Paginação
    const skip = parseInt(args.extra.skip) || 0;
    const limit = 100;
    const paginatedChannels = filteredChannels.slice(skip, skip + limit);

    // Criar metadados para os canais
    const metas = paginatedChannels.map(channel => ({
        id: 'iptv_channel:' + encodeURIComponent(channel.name),
        type: 'tv',
        name: channel.name,
        poster: channel.logo,
        genres: [channel.genre],
        posterShape: 'square'
    }));

    console.log(`Retornando ${metas.length} canais`);
    return { metas };
});

builder.defineStreamHandler(async function(args) {
    console.log('Stream solicitado:', args);
    if (args.type === 'tv' && args.id.startsWith('iptv_channel:')) {
        const channelName = decodeURIComponent(args.id.split(':')[1]);
        const channels = await getIPTVList(m3uLink);  // Utiliza o link M3U
        const channel = channels.find(ch => ch.name === channelName);

        if (channel) {
            console.log('Stream encontrado:', channel.name);
            return {
                streams: [
                    {
                        title: channel.name,
                        url: channel.url
                    }
                ]
            };
        }
    }
    console.log('Stream não encontrado');
    return { streams: [] };
});

// Iniciar o servidor Stremio
findAvailablePort(7000).then(port => {
    serveHTTP(builder.getInterface(), { port });
    console.log(`Addon iniciado na porta ${port}`);
}).catch(err => {
    console.error('Erro ao iniciar o addon:', err);
});

function findAvailablePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                findAvailablePort(startPort + 1).then(resolve, reject);
            } else {
                reject(err);
            }
        });
    });
}
