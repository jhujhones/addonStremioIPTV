const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Manifesto do Addon
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
            name: 'Canais IPTV',
        },
        {
            type: 'tv',
            id: 'iptv_genres',
            name: 'Gêneros IPTV',
        }
    ]
};

const builder = new addonBuilder(manifest);

let cachedChannels = null;
const CACHE_TTL = 3600000; // 1 hora em milissegundos
let lastCacheTime = 0;

async function getIPTVList() {
    const now = Date.now();
    if (cachedChannels && (now - lastCacheTime < CACHE_TTL)) {
        console.log('Usando lista IPTV em cache');
        return cachedChannels;
    }

    try {
        console.log('Obtendo lista IPTV...');
        const response = await axios.get('http://4f.rs:80/get.php?username=antonio2024&password=antonio2024&type=m3u_plus');
        console.log('Lista IPTV obtida com sucesso');
        cachedChannels = parseM3U(response.data);
        lastCacheTime = now;
        return cachedChannels;
    } catch (error) {
        console.error('Erro ao obter a lista IPTV:', error);
        return [];
    }
}

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
                    genre: matches[2]
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

builder.defineCatalogHandler(async function(args) {
    console.log('Catálogo solicitado:', args);
    if (args.type === 'tv' && args.id === 'iptv_channels') {
        const channels = await getIPTVList();
        
        const metas = channels.map(channel => ({
            id: 'iptv_channel:' + encodeURIComponent(channel.name),
            type: 'tv',
            name: channel.name,
            poster: channel.logo,
            genres: [channel.genre] // Adiciona o gênero
        }));

        console.log(`Retornando ${metas.length} canais`);
        return { metas };
    } else if (args.type === 'tv' && args.id === 'iptv_genres') {
        const channels = await getIPTVList();
        
        // Agrupar canais por group-title
        const groupedChannels = channels.reduce((acc, channel) => {
            const group = channel.genre || "Sem Gênero"; // Use "Sem Gênero" como padrão
            if (!acc[group]) {
                acc[group] = [];
            }
            acc[group].push(channel);
            return acc;
        }, {});

        // Criar metas para cada grupo
        const metas = Object.entries(groupedChannels).map(([group, groupChannels]) => ({
            id: 'iptv_genre:' + encodeURIComponent(group),
            type: 'tv',
            name: group, // Nome do grupo
            poster: groupChannels[0].logo || 'https://via.placeholder.com/150', // Logo do primeiro canal como placeholder
            genres: [group]
        }));

        console.log(`Retornando ${metas.length} gêneros`);
        return { metas };
    } else {
        console.log('Catálogo não reconhecido');
        return { metas: [] };
    }
});

builder.defineStreamHandler(async function(args) {
    console.log('Stream solicitado:', args);
    if (args.type === 'tv' && args.id.startsWith('iptv_channel:')) {
        const channelName = decodeURIComponent(args.id.split(':')[1]);
        const channels = await getIPTVList();
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

// Inicia o addon
const addonInterface = builder.getInterface();
module.exports = addonInterface;

// Inicia o servidor express para o addon
const express = require("express");
const app = express();

// Middleware para permitir CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permitir acesso de qualquer origem
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Definindo as rotas para o addon
app.use("/manifest.json", (req, res) => res.json(addonInterface.manifest));
app.use("/catalog/:type/:id.json", (req, res) => {
    addonInterface.get(req.path)
        .then(r => res.json(r))
        .catch(err => {
            console.error("Erro ao acessar o catálogo:", err);
            res.status(500).send("Erro ao acessar o catálogo");
        });
});
app.use("/stream/:type/:id.json", (req, res) => {
    addonInterface.get(req.path)
        .then(r => res.json(r))
        .catch(err => {
            console.error("Erro ao acessar o stream:", err);
            res.status(500).send("Erro ao acessar o stream");
        });
});

// Inicia o servidor na porta 7001
const PORT = 7001;
app.listen(PORT, () => {
    console.log(`Addon rodando na porta ${PORT}`);
});
