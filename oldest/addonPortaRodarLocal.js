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
    description: "Addon IPTV personalizado com categorias",
    resources: ["catalog", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: 'tv',
            id: 'iptv_channels',
            name: '📺 Canais IPTV',
            extra: [
                {
                    name: "genre",
                    isRequired: false,
                    options: [],  // Atualizar com categorias posteriormente
                    optionsLimit: 200,
                },
                { name: "skip", isRequired: false }
            ]
        }
    ]
};

async function getIPTVList() {
    const now = Date.now();
    if (cachedChannels && (now - lastCacheTime < CACHE_TTL)) {
        return cachedChannels;
    }

    try {
        const response = await axios.get('http://4f.rs:80/get.php?username=antonio2024&password=antonio2024&type=m3u_plus');
        cachedChannels = parseM3U(response.data);
        
        // Atualizar cache de categorias
        cachedCategories = [...new Set(cachedChannels.map(ch => ch.genre))]
            .filter(Boolean)
            .sort();
            
        // Atualizar o manifest com as categorias
        manifest.catalogs[0].extra[0].options = cachedCategories;
        
        lastCacheTime = now;
        return cachedChannels;
    } catch (error) {
        console.error('Erro ao obter a lista IPTV:', error);
        return [];
    }
}

function parseM3U(m3uContent) {
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
                    genre: matches[2].trim() // Garantir que não tenha espaços extras
                };
            }
        } else if (line.trim().startsWith('http') && currentChannel) {
            currentChannel.url = line.trim();
            channels.push(currentChannel);
            currentChannel = null;
        }
    }

    return channels;
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async function(args) {
    if (args.type === 'tv' && args.id === 'iptv_channels') {
        const channels = await getIPTVList();
        let filteredChannels = channels;

        // Verificar e aplicar filtro de gênero
        if (args.extra.genre) {
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

        return { metas };
    }
    
    return { metas: [] };
});

builder.defineStreamHandler(async function(args) {
    if (args.type === 'tv' && args.id.startsWith('iptv_channel:')) {
        const channelName = decodeURIComponent(args.id.split(':')[1]);
        const channels = await getIPTVList();
        const channel = channels.find(ch => ch.name === channelName);

        if (channel) {
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
    return { streams: [] };
});

// Carregar a lista inicial e preencher as categorias ANTES de iniciar o servidor
getIPTVList().then(() => {
    findAvailablePort(7000).then(port => {
        serveHTTP(builder.getInterface(), { port: port });
        console.log(`Addon iniciado na porta ${port}`);
    }).catch(err => {
        console.error('Erro ao iniciar o addon:', err);
    });

}).catch(err => {
    console.error('Erro ao carregar categorias:', err);
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
