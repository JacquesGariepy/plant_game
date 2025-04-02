// server.js (v7.7 - Seed Harvesting & Planting Logic)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const GAMESTATE_FILE = path.join(__dirname, 'gamestate.json');
const SAVE_INTERVAL = 20 * 1000; // 20 seconds
const GAME_LOOP_INTERVAL = 1000; // 1 second
const LEADERBOARD_UPDATE_INTERVAL = 10 * 1000; // 10 seconds
const EVENT_CHECK_INTERVAL = 5 * 60 * 1000; // Check/change event every 5 minutes

// --- Game Constants (v7.7) ---
const MAX_LOG_ENTRIES = 30;
const MAX_PLANTS = 50;
// Action effects & Costs
const WATER_PER_CLICK = 30;
const FERTILIZER_PER_CLICK = 40;
const PESTICIDE_EFFECT = 50;
const PESTICIDE_STRONG_EFFECT = 80;
const MUSIC_DURATION = 2 * 60 * 1000;
const CLEAN_LEAVES_ENERGY_BOOST = 3;
const PRUNE_HEALTH_BOOST = 5;
const TALK_ENERGY_BOOST = 5;
const MIST_WATER_BOOST = 5;
const MIST_ENERGY_BOOST = 2;
const WATER_ALL_BOOST = 8;
// Rates & Thresholds
const HEALTH_REGEN_RATE = 1; // Per hour
const HEALTH_LOSS_RATE = 3;  // Per hour base rate
const AGING_HEALTH_LOSS_RATE = 1; // Additional health loss per hour for neglected mature plants
const WATER_DEPLETION_RATE_PER_HOUR = 4;
const ENERGY_GAIN_RATE_PER_HOUR = 15;
const ENERGY_DEPLETION_RATE_PER_HOUR = 8;
const FERTILIZER_DEPLETION_RATE_PER_HOUR = 3;
const PEST_INCREASE_RATE_PER_HOUR = 2;
const PEST_DECREASE_RATE_PER_HOUR = 1;
const ENVIRONMENT_CHANGE_CHANCE = 0.05;
// Cooldowns (ms) - v7.7
const TALK_COOLDOWN = 60 * 1000;
const FERTILIZE_COOLDOWN = 5 * 60 * 1000;
const PESTICIDE_COOLDOWN = 10 * 60 * 1000;
const REPOT_COOLDOWN = 12 * 60 * 60 * 1000;
const PLAY_MUSIC_COOLDOWN = 15 * 60 * 1000;
const CLEAN_LEAVES_COOLDOWN = 2 * 60 * 1000;
const PRUNE_COOLDOWN = 6 * 60 * 60 * 1000;
const ENV_CHECK_COOLDOWN = 30 * 1000;
const CREATE_PLANT_COOLDOWN = 1 * 60 * 1000; // Cooldown for creating standard plant
const OBSERVE_COOLDOWN = 1 * 60 * 1000;
const HARVEST_COOLDOWN = 4 * 60 * 60 * 1000;
const MIST_COOLDOWN = 30 * 1000;
const WATER_ALL_COOLDOWN = 5 * 60 * 1000;
const PLANT_SEED_COOLDOWN = 1 * 60 * 1000; // Cooldown for planting a harvested seed
// Scoring & Currency
const SCORE_PER_ACTION = 1;
const SCORE_PER_GROWTH = 10;
const SCORE_PER_FLOWER = 50;
const SCORE_PER_SEED_HARVEST = 25; // Score for harvesting
const SCORE_PER_SEED_PLANT = 5;    // Score for planting
const SCORE_PER_OBSERVE = 2;
const SCORE_PER_MIST = 1;
const COINS_PER_QUEST = 50;
const COINS_PER_HARVEST = 10; // Coins for harvesting

// Shop Items (Unchanged from v7.3 provided)
const SHOP_ITEMS = {
    'seed_basic': { name: "Graine Standard", price: 100, type: 'seed', description: "Une graine simple pour commencer." },
    'fertilizer_boost': { name: "Engrais Rapide", price: 75, type: 'boost', effect: 'fertilizer', amount: 50, duration: 1 * 36e5, description: "Boost temporaire d'engrais." },
    'pesticide_strong': { name: "Pesticide Puissant", price: 150, type: 'consumable', effect: 'pesticide', amount: PESTICIDE_STRONG_EFFECT, description: "Élimine plus de nuisibles." },
    'pot_red': { name: "Pot Rouge", price: 50, type: 'cosmetic', value: '#e57373', description: "Change la couleur du pot." },
    'pot_blue': { name: "Pot Bleu", price: 50, type: 'cosmetic', value: '#64b5f6', description: "Change la couleur du pot." },
    'pot_yellow': { name: "Pot Jaune", price: 50, type: 'cosmetic', value: '#fff176', description: "Change la couleur du pot." },
    'pot_purple': { name: "Pot Violet", price: 75, type: 'cosmetic', value: '#ba68c8', description: "Change la couleur du pot." },
    'pot_white': { name: "Pot Blanc", price: 25, type: 'cosmetic', value: '#ffffff', description: "Change la couleur du pot." },
    'pot_black': { name: "Pot Noir", price: 75, type: 'cosmetic', value: '#424242', description: "Change la couleur du pot." },
};

// --- Characteristics Definitions (Unchanged from v7.3 provided) ---
const GROWTH_STAGES = {
    GRAINE:    { n: "Graine",        i: "fa-seedling", nt: 'POUSSE',    t: 0,                   r: false, p: false },
    POUSSE:    { n: "Pousse",        i: "fa-seedling", nt: 'JEUNE',     t: 1 * 36e5,            r: false, p: false }, // 1 hour
    JEUNE:     { n: "Jeune Plante",  i: "fa-leaf",     nt: 'MATURE',    t: 6 * 36e5,            r: true,  p: false }, // 6 hours
    MATURE:    { n: "Plante Mature", i: "fa-spa",      nt: 'FLORAISON', t: 24 * 36e5,           r: true,  p: true },  // 24 hours
    FLORAISON: { n: "En Fleur",      i: "fa-fan",      nt: null,        t: Infinity,            r: true,  p: true }   // Final stage
};
const POT_SIZES = ['Petit', 'Moyen', 'Large'];
const ENVIRONMENT_STATUSES = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide', 'Infesté de nuisibles'];
const PLANT_COLORS = ['#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7']; // Greens
const LEAF_SHAPES = ['Ovale', 'Pointue', 'Dentelée', 'Lobée', 'Cordée'];
const FLOWER_COLORS = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#ffffff', '#ffeb3b', '#ff9800']; // Pinks, Purples, Blues, White, Yellow, Orange
const TOLERANCE_LEVELS = ['Basse', 'Moyenne', 'Haute'];
const RARE_TRAITS = [ { n:'Feuilles Scintillantes',d:'Ses feuilles brillent légèrement.'}, { n:'Lueur Nocturne',d:'Émet une douce lueur dans le noir.'}, { n:'Parfum Envoûtant',d:'Dégage un parfum agréable et unique.'}, { n:'Mélodie Murmurante',d:'Semble fredonner une douce mélodie.'}, { n:'Nectar Précieux',d:'Produit un nectar rare et sucré.'} ];
const RARE_TRAIT_CHANCE = 0.03; // 3% chance

// --- Quest Definitions (Unchanged from v7.3 provided) ---
const QUESTS = [
    { id: 'water3', description: "Arroser 3 plantes différentes", target: 3, action: 'waterPlant', uniqueTarget: true, reward: { score: 10, coins: COINS_PER_QUEST } },
    { id: 'clean5', description: "Nettoyer les feuilles de 5 plantes", target: 5, action: 'cleanLeaves', reward: { score: 15, coins: COINS_PER_QUEST } },
    { id: 'observe2', description: "Observer 2 plantes", target: 2, action: 'observePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } },
    { id: 'fertilize1', description: "Fertiliser 1 plante", target: 1, action: 'fertilizePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } },
    { id: 'mist4', description: "Brumiser 4 fois", target: 4, action: 'gentleMist', reward: { score: 8, coins: COINS_PER_QUEST / 2 } },
];

// --- Event Definitions (Unchanged from v7.3 provided) ---
const EVENTS = [
    { id: 'fertilizer_bonus', name: "Fertilisation Efficace !", duration: 30 * 60 * 1000, effectMultiplier: { fertilizer: 1.5 }, description: "L'engrais est 50% plus efficace." },
    { id: 'growth_spurt', name: "Poussée de Croissance !", duration: 1 * 60 * 60 * 1000, effectMultiplier: { growth: 1.3 }, description: "Les plantes grandissent 30% plus vite." },
    { id: 'pest_resistance', name: "Résistance aux Nuisibles", duration: 2 * 60 * 60 * 1000, effectMultiplier: { pest_resist: 1.5 }, description: "Les plantes résistent mieux aux nuisibles." },
    { id: 'harvest_bounty', name: "Récolte Abondante", duration: 1 * 60 * 60 * 1000, effectMultiplier: { harvest_coins: 2 }, description: "Récolter des graines rapporte double pièces." },
    { id: 'care_bonus', name: "Soins Récompensés", duration: 45 * 60 * 1000, effectMultiplier: { care_score: 2 }, description: "Les actions de soin de base rapportent double score." },
];
const EVENT_CHANCE = 0.15;

// --- Game State Structure (v7.7) ---
let gameState = {
    plants: {},      // { plantId: { plantData } }
    scores: {},      // { userId: { username, score, coins, seeds } } // Added seeds
    users: {},       // { socketId: { userId, username, lastActionTimes, currentQuest, questProgressData, lastPlantSeedTime } } // Added lastPlantSeedTime
    logs: [],        // [{ user, action, timestamp }]
    currentEvent: null // { id, name, endTime, description, effectMultiplier }
};
let lastSaveTime = 0;
let gameLoopTimer = null;
let leaderboardUpdateTimer = null;
let eventTimer = null;

// --- Utility Functions (Unchanged from v7.3 provided, except getUsername fix) ---
function getCurrentTimestamp() { return Date.now(); }
function randomInRange(min, max) { return Math.random() * (max - min) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getUserId(socketId) { return gameState.users[socketId]?.userId; }
function getUsername(userId) {
    if (!userId) return 'Inconnu';
    if (gameState.scores[userId]) return gameState.scores[userId].username;
    // Fallback: find username from users object if score entry doesn't exist yet
    for (const sId in gameState.users) {
        if (gameState.users[sId].userId === userId) return gameState.users[sId].username;
    }
    return 'Anonyme'; // Return Anonyme if not found anywhere
}
function getRandomEnvStatus(currentPestLevel) {
    const pestChance = Math.min(0.5, currentPestLevel / 150);
    if (Math.random() < pestChance) return 'Infesté de nuisibles';
    const statuses = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide'];
    return randomChoice(statuses);
}
function generatePlantCharacteristics() {
    let rareTrait = null;
    if (Math.random() < RARE_TRAIT_CHANCE) { rareTrait = randomChoice(RARE_TRAITS); }
    return {
        waterNeedFactor: randomInRange(0.8, 1.2), lightNeedFactor: randomInRange(0.8, 1.2),
        fertilizerNeedFactor: randomInRange(0.7, 1.3), baseColor: randomChoice(PLANT_COLORS),
        leafShape: randomChoice(LEAF_SHAPES), flowerColor: randomChoice(FLOWER_COLORS),
        growthRateFactor: randomInRange(0.9, 1.1), pestResistanceFactor: randomInRange(0.8, 1.2),
        envResistanceFactor: randomInRange(0.8, 1.2), lifespanFactor: randomInRange(0.9, 1.1),
        waterTolerance: randomChoice(TOLERANCE_LEVELS), lightTolerance: randomChoice(TOLERANCE_LEVELS),
        rareTrait: rareTrait ? rareTrait.n : null,
    };
}

// --- Game State Management (v7.7) ---
function initializeGameState() {
    console.log("Initializing new game state v7.7...");
    gameState.plants = {};
    gameState.scores = {};
    gameState.users = {};
    gameState.logs = [];
    gameState.currentEvent = null;
    createPlant("Système", "Gaïa Prima", "Système");
    saveGameState();
}

function loadGameState() {
    try {
        if (fs.existsSync(GAMESTATE_FILE)) {
            const data = fs.readFileSync(GAMESTATE_FILE, 'utf8');
            const loadedData = JSON.parse(data);

            gameState.plants = loadedData.plants && typeof loadedData.plants === 'object' ? loadedData.plants : {};
            gameState.scores = loadedData.scores && typeof loadedData.scores === 'object' ? loadedData.scores : {};
            gameState.logs = Array.isArray(loadedData.logs) ? loadedData.logs.slice(0, MAX_LOG_ENTRIES * 5) : [];
            gameState.currentEvent = loadedData.currentEvent || null;
            gameState.users = {}; // Reset users, they reconnect

            // Ensure scores have coins AND seeds (v7.7 update)
            for (const userId in gameState.scores) {
                gameState.scores[userId].coins = gameState.scores[userId].coins || 0;
                gameState.scores[userId].seeds = gameState.scores[userId].seeds || 0; // Initialize seeds if missing
            }

            // Validate and apply defaults to each loaded plant (Unchanged from v7.3)
            let plantCount = 0;
            for (const plantId in gameState.plants) {
                plantCount++;
                const plant = gameState.plants[plantId];
                const defaults = {
                    health: 100, potColor: '#A1887F', waterLevel: 100, energyLevel: 100,
                    fertilizerLevel: 0, pestLevel: 0, isLightOn: false, growthStage: 'GRAINE',
                    potSize: 'Petit', isMusicPlaying: false, musicEndTime: 0, environmentStatus: 'Optimal',
                    timeBorn: getCurrentTimestamp(), lastUpdateTime: getCurrentTimestamp(),
                    lastWateredBy: "?", lastLightToggleBy: "?", lastFertilizedBy: "?",
                    lastPesticideBy: "?", lastRepottedBy: "?", lastMusicBy: "?", lastCleanedBy: "?",
                    lastPrunedBy: "?", lastTalkTime: 0, lastFertilizeTime: 0, lastPesticideTime: 0,
                    lastRepotTime: 0, lastPlayMusicTime: 0, lastCleanTime: 0, lastPruneTime: 0,
                    lastCheckEnvTime: 0, lastObserveTime: 0, lastHarvestTime: 0, lastMistTime: 0,
                    growthProgress: 0
                };
                for (const key in defaults) { if (plant[key] === undefined || plant[key] === null) { plant[key] = defaults[key]; } }
                if (!plant.characteristics || typeof plant.characteristics !== 'object') { plant.characteristics = generatePlantCharacteristics(); }
                else { const charDefaults = { waterNeedFactor: 1, lightNeedFactor: 1, fertilizerNeedFactor: 1, baseColor: PLANT_COLORS[0], leafShape: LEAF_SHAPES[0], flowerColor: FLOWER_COLORS[0], growthRateFactor: 1, pestResistanceFactor: 1, envResistanceFactor: 1, lifespanFactor: 1, waterTolerance: 'Moyenne', lightTolerance: 'Moyenne', rareTrait: null }; for (const charKey in charDefaults) { if (plant.characteristics[charKey] === undefined || plant.characteristics[charKey] === null) { plant.characteristics[charKey] = charDefaults[charKey]; } } }
                if (!GROWTH_STAGES[plant.growthStage]) { console.warn(`Invalid growth stage "${plant.growthStage}" for plant ${plantId}. Resetting to GRAINE.`); plant.growthStage = 'GRAINE'; plant.growthProgress = 0; }
                if (plant.growthProgress === undefined) { plant.growthProgress = 0; }
            }
            if (plantCount === 0) { console.log("No plants found in saved state. Creating initial plant."); createPlant("Système", "Gaïa Prima", "Système"); }
            console.log(`Game state loaded successfully. ${plantCount} plants, ${Object.keys(gameState.scores).length} scores.`);
        } else {
            console.log("No gamestate file found. Initializing new game.");
            initializeGameState();
        }
    } catch (error) {
        console.error("Error loading game state:", error);
        console.log("Initializing fresh game state due to load error.");
        initializeGameState();
    }
}

function saveGameState() {
    const now = getCurrentTimestamp();
    if (now - lastSaveTime < 5000 && lastSaveTime !== 0) { return; }
    lastSaveTime = now;
    console.log(`Saving game state at ${new Date(now).toLocaleTimeString()}...`);
    try {
        if (gameState.logs.length > MAX_LOG_ENTRIES * 10) { console.warn(`Pruning logs from ${gameState.logs.length} before saving.`); gameState.logs = gameState.logs.slice(0, MAX_LOG_ENTRIES * 5); }
        const dataToSave = {
            plants: gameState.plants,
            scores: gameState.scores, // Includes coins and seeds
            logs: gameState.logs,
            currentEvent: gameState.currentEvent
        };
        fs.writeFile(GAMESTATE_FILE, JSON.stringify(dataToSave), 'utf8', (err) => { if (err) { console.error("Error writing game state asynchronously:", err); } });
    } catch (error) { console.error("Error saving game state:", error); }
}

function addLogEntry(user, action, plantName = null) {
    const logAction = plantName ? `${action} (${plantName})` : action;
    const newLog = { user: user || 'Système', action: logAction, timestamp: getCurrentTimestamp() };
    gameState.logs.unshift(newLog);
    if (gameState.logs.length > MAX_LOG_ENTRIES * 5) { gameState.logs = gameState.logs.slice(0, MAX_LOG_ENTRIES * 5); }
    broadcastLogs();
}

// Updated addScore to handle seeds (v7.7)
function updatePlayerResources(userId, scorePoints = 0, coinAmount = 0, seedAmount = 0) {
    if (!userId || (scorePoints === 0 && coinAmount === 0 && seedAmount === 0)) return;

    // Initialize score entry if it doesn't exist
    if (!gameState.scores[userId]) {
        let username = getUsername(userId);
        gameState.scores[userId] = { username: username, score: 0, coins: 0, seeds: 0 }; // Initialize with seeds
    }

    gameState.scores[userId].score = (gameState.scores[userId].score || 0) + scorePoints;
    gameState.scores[userId].coins = (gameState.scores[userId].coins || 0) + coinAmount;
    gameState.scores[userId].seeds = Math.max(0, (gameState.scores[userId].seeds || 0) + seedAmount); // Ensure seeds don't go below 0

    console.log(`Resources Update - User: ${userId} (${gameState.scores[userId].username}), Score: ${gameState.scores[userId].score} (+${scorePoints}), Coins: ${gameState.scores[userId].coins} (+${coinAmount}), Seeds: ${gameState.scores[userId].seeds} (+${seedAmount})`);
}

function updateScoreUsername(userId, newUsername) {
    if (gameState.scores[userId]) {
        gameState.scores[userId].username = newUsername;
    } else {
        // If score entry didn't exist yet, create it with seeds
        gameState.scores[userId] = { username: newUsername, score: 0, coins: 0, seeds: 0 };
    }
}

// --- Quest Management (Unchanged from v7.3 provided) ---
function assignNewQuest(socketId) {
    const user = gameState.users[socketId]; if (!user) return;
    const completedQuestId = user.currentQuest?.id;
    const availableQuests = QUESTS.filter(q => q.id !== completedQuestId);
    const questPool = availableQuests.length > 0 ? availableQuests : QUESTS;
    const newQuestTemplate = randomChoice(questPool);
    user.currentQuest = { id: newQuestTemplate.id, description: newQuestTemplate.description, progress: 0, target: newQuestTemplate.target, action: newQuestTemplate.action, reward: newQuestTemplate.reward, completed: false, uniqueTarget: newQuestTemplate.uniqueTarget || false };
    user.questProgressData = {};
    console.log(`New quest assigned '${user.currentQuest.id}' to ${user.username} (${user.userId})`);
    io.to(socketId).emit('questUpdate', user.currentQuest);
}
function checkQuestProgress(socketId, actionName, plantId = null) {
    const user = gameState.users[socketId]; if (!user || !user.currentQuest || user.currentQuest.completed) return;
    const quest = user.currentQuest;
    if (quest.action === actionName) {
        let progressMade = false;
        if (quest.uniqueTarget && plantId) { if (!user.questProgressData[plantId]) { user.questProgressData[plantId] = true; quest.progress++; progressMade = true; } }
        else if (!quest.uniqueTarget) { quest.progress++; progressMade = true; }
        if (progressMade) {
            console.log(`Quest '${quest.id}' progress for ${user.username}: ${quest.progress}/${quest.target}`);
            if (quest.progress >= quest.target) {
                quest.completed = true;
                updatePlayerResources(user.userId, quest.reward.score, quest.reward.coins, 0); // Use updated resource function
                addLogEntry(user.username, `a complété la quête: ${quest.description}! (+${quest.reward.score} score, +${quest.reward.coins}p)`);
                io.to(socketId).emit('questUpdate', quest);
                io.to(socketId).emit('actionFeedback', { success: true, message: `Quête "${quest.description}" complétée ! Récompense: ${quest.reward.score} score, ${quest.reward.coins} pièces !`, sound: 'questComplete' });
                setTimeout(() => assignNewQuest(socketId), 4000);
            } else { io.to(socketId).emit('questUpdate', quest); }
        }
    }
}

// --- Event Management (Unchanged from v7.3 provided) ---
function checkEvent() {
    const now = getCurrentTimestamp();
    if (gameState.currentEvent && now >= gameState.currentEvent.endTime) { console.log(`Event ended: ${gameState.currentEvent.name}`); addLogEntry("Système", `L'événement "${gameState.currentEvent.name}" est terminé.`); gameState.currentEvent = null; broadcastEventUpdate(); saveGameState(); }
    else if (!gameState.currentEvent) { if (Math.random() < EVENT_CHANCE) { startRandomEvent(); } }
}
function startRandomEvent() {
    const eventTemplate = randomChoice(EVENTS); const now = getCurrentTimestamp();
    gameState.currentEvent = { id: eventTemplate.id, name: eventTemplate.name, description: eventTemplate.description, endTime: now + eventTemplate.duration, effectMultiplier: eventTemplate.effectMultiplier || {} };
    console.log(`Event started: ${gameState.currentEvent.name} (Ends at: ${new Date(gameState.currentEvent.endTime).toLocaleTimeString()})`); addLogEntry("Système", `Événement démarré : ${gameState.currentEvent.name} (${gameState.currentEvent.description})`); broadcastEventUpdate(); saveGameState();
}
function getEventMultiplier(effectType) { return gameState.currentEvent?.effectMultiplier?.[effectType] || 1; }

// --- Broadcasting (v7.7) ---
function broadcastPlantsUpdate() { io.emit('plantsUpdate', gameState.plants); }
function broadcastLogs() { io.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES)); }
function broadcastLeaderboard() { io.emit('leaderboardUpdate', getTopScores()); }
// Updated broadcastPlayerInfo to include seeds
function broadcastPlayerInfo(socketId) {
    const user = gameState.users[socketId];
    if (user && user.userId && gameState.scores[user.userId]) {
        const scoreData = gameState.scores[user.userId];
        io.to(socketId).emit('playerInfoUpdate', {
            username: scoreData.username,
            score: scoreData.score,
            coins: scoreData.coins,
            seeds: scoreData.seeds // Include seeds
        });
    }
}
function broadcastEventUpdate() { io.emit('eventUpdate', gameState.currentEvent); }

// --- Plant Creation (Unchanged from v7.3 provided) ---
function createPlant(creatorId, creatorName, plantNameRequest = null) {
    if (Object.keys(gameState.plants).length >= MAX_PLANTS) { console.log("Cannot create plant: Maximum number of plants reached."); return null; }
    const now = getCurrentTimestamp(); const plantId = uuidv4(); const characteristics = generatePlantCharacteristics();
    const safeName = String(plantNameRequest || `Plante de ${creatorName}`).trim().substring(0, 30) || `Plante_${plantId.substring(0, 4)}`;
    const newPlant = {
        plantId: plantId, name: safeName, creatorId: creatorId, creatorName: creatorName, characteristics: characteristics,
        health: 100, waterLevel: 80, energyLevel: 80, fertilizerLevel: 10, pestLevel: 0,
        isLightOn: false, growthStage: 'GRAINE', growthProgress: 0, potSize: 'Petit', potColor: '#A1887F',
        isMusicPlaying: false, musicEndTime: 0, environmentStatus: 'Optimal',
        timeBorn: now, lastUpdateTime: now, lastWateredBy: "?", lastLightToggleBy: "?", lastFertilizedBy: "?",
        lastPesticideBy: "?", lastRepottedBy: "?", lastMusicBy: "?", lastCleanedBy: "?", lastPrunedBy: "?",
        lastTalkTime: 0, lastFertilizeTime: 0, lastPesticideTime: 0, lastRepotTime: 0, lastPlayMusicTime: 0,
        lastCleanTime: 0, lastPruneTime: 0, lastCheckEnvTime: 0, lastObserveTime: 0, lastHarvestTime: 0, lastMistTime: 0,
    };
    gameState.plants[plantId] = newPlant;
    console.log(`Plant created: ID ${plantId}, Name: ${safeName}, Creator: ${creatorName} (${creatorId})`);
    addLogEntry(creatorName, `a créé la plante: ${newPlant.name}`);
    broadcastPlantsUpdate();
    return plantId;
}

// --- Game Loop Logic (Unchanged from v7.3 provided) ---
function gameLoop() {
    const now = getCurrentTimestamp(); let needsBroadcast = false;
    const plantIds = Object.keys(gameState.plants); const plantCount = plantIds.length; if (plantCount === 0) return;
    const effectiveEnvChangeChance = Math.max(0.005, ENVIRONMENT_CHANGE_CHANCE / Math.sqrt(plantCount));
    for (const plantId of plantIds) {
        const ps = gameState.plants[plantId]; if (!ps) continue;
        const lastUpdate = ps.lastUpdateTime || now; const timeDiffMs = now - lastUpdate; if (timeDiffMs <= 0) continue;
        let plantChanged = false; const timeDiffHours = timeDiffMs / 3600000.0; const char = ps.characteristics || {};
        const waterTolFactor = char.waterTolerance === 'Haute' ? 0.7 : (char.waterTolerance === 'Basse' ? 1.3 : 1);
        const lightTolFactor = char.lightTolerance === 'Haute' ? 0.7 : (char.lightTolerance === 'Basse' ? 1.3 : 1);
        const pestResFactor = char.pestResistanceFactor || 1; const envResFactor = char.envResistanceFactor || 1; const lifeFactor = char.lifespanFactor || 1;
        const isWilted = ps.health <= 0; const isMature = ps.growthStage === 'MATURE' || ps.growthStage === 'FLORAISON'; const isNeglected = ps.waterLevel < 20 || ps.energyLevel < 20 || ps.health < 50;
        let healthChange = 0;
        if (!isWilted) {
            if (ps.waterLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTolFactor; if (ps.waterLevel > 98) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTolFactor * 0.5;
            if (ps.energyLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * lightTolFactor;
            if (ps.pestLevel > 60) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 1.5 / pestResFactor; else if (ps.pestLevel > 30) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.8 / pestResFactor;
            if (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') { healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.5 / envResFactor; }
            if (isMature && isNeglected) { healthChange -= AGING_HEALTH_LOSS_RATE * timeDiffHours / lifeFactor; }
            if (ps.waterLevel > 50 && ps.energyLevel > 50 && ps.pestLevel < 20 && ps.fertilizerLevel > 5) { healthChange += HEALTH_REGEN_RATE * timeDiffHours * lifeFactor; }
            const previousHealth = ps.health; ps.health = Math.max(0, Math.min(100, ps.health + healthChange)); if (ps.health !== previousHealth) plantChanged = true;
            if (ps.health <= 0 && previousHealth > 0) { addLogEntry("Système", `La plante "${ps.name}" a flétri...`); if (ps.isMusicPlaying) ps.isMusicPlaying = false; plantChanged = true; ps.growthProgress = 0; }
        }
        if (!isWilted) {
            const waterNeedFactor = char.waterNeedFactor || 1; const waterDepletion = (WATER_DEPLETION_RATE_PER_HOUR * waterNeedFactor / lifeFactor) * timeDiffHours; const previousWater = ps.waterLevel; ps.waterLevel = Math.max(0, ps.waterLevel - waterDepletion); if (ps.waterLevel !== previousWater) plantChanged = true;
            const lightNeedFactor = char.lightNeedFactor || 1; const pestEffectOnEnergy = Math.max(0.3, (1 - ps.pestLevel / 150)); const envEffectOnEnergy = (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') ? 0.7 : 1; const previousEnergy = ps.energyLevel;
            if (ps.isLightOn) { const energyGain = timeDiffHours * ENERGY_GAIN_RATE_PER_HOUR * lightNeedFactor * pestEffectOnEnergy * envEffectOnEnergy; ps.energyLevel = Math.min(100, ps.energyLevel + energyGain); if (char.lightTolerance === 'Basse' && ps.energyLevel > 95) { const previousWaterBurn = ps.waterLevel; ps.waterLevel = Math.max(0, ps.waterLevel - (timeDiffHours * 2)); if(ps.waterLevel !== previousWaterBurn) plantChanged = true; } }
            else { const energyDepletion = timeDiffHours * ENERGY_DEPLETION_RATE_PER_HOUR * lightNeedFactor * envEffectOnEnergy * lightTolFactor; ps.energyLevel = Math.max(0, ps.energyLevel - energyDepletion); }
            if (ps.energyLevel !== previousEnergy) plantChanged = true;
            const fertNeedFactor = char.fertilizerNeedFactor || 1; const fertDepletion = timeDiffHours * FERTILIZER_DEPLETION_RATE_PER_HOUR * fertNeedFactor; const previousFert = ps.fertilizerLevel; ps.fertilizerLevel = Math.max(0, ps.fertilizerLevel - fertDepletion); if (ps.fertilizerLevel !== previousFert) plantChanged = true;
            let pestChange = 0; const pestResistEventMultiplier = getEventMultiplier('pest_resist');
            if (ps.waterLevel < 40 || ps.energyLevel < 40) { pestChange = timeDiffHours * PEST_INCREASE_RATE_PER_HOUR * 1.5 / (pestResFactor * 0.8); }
            else if (ps.waterLevel > 80 && ps.energyLevel > 80) { pestChange = -(timeDiffHours * PEST_DECREASE_RATE_PER_HOUR * pestResFactor * pestResistEventMultiplier); }
            else { pestChange = timeDiffHours * PEST_INCREASE_RATE_PER_HOUR * 0.5 / pestResFactor; }
            if (ps.environmentStatus === 'Infesté de nuisibles') pestChange *= 2; if (ps.environmentStatus === 'Optimal') pestChange *= 0.5; const previousPest = ps.pestLevel; ps.pestLevel = Math.max(0, Math.min(100, ps.pestLevel + pestChange)); if (ps.pestLevel !== previousPest) plantChanged = true;
            if (ps.isMusicPlaying && now >= ps.musicEndTime) { ps.isMusicPlaying = false; plantChanged = true; }
            if (Math.random() < effectiveEnvChangeChance * timeDiffHours) { const oldEnv = ps.environmentStatus; ps.environmentStatus = getRandomEnvStatus(ps.pestLevel); if (ps.environmentStatus !== oldEnv) { plantChanged = true; } }
        }
        const currentStage = ps.growthStage; const stageData = GROWTH_STAGES[currentStage]; let previousGrowthProgress = ps.growthProgress || 0;
        if (ps.health > 50 && !isWilted && stageData && stageData.t !== Infinity) {
            const nextStageKey = stageData.nt; const nextStageData = nextStageKey ? GROWTH_STAGES[nextStageKey] : null;
            if (nextStageData) {
                const growthRateEventMultiplier = getEventMultiplier('growth'); const growthRate = (char.growthRateFactor || 1) * growthRateEventMultiplier; const healthFactor = (ps.health >= 70) ? 1 : 0.8; const potFactor = (ps.potSize === 'Petit' && (currentStage === 'JEUNE' || currentStage === 'MATURE' || currentStage === 'FLORAISON')) ? 0.6 : (ps.potSize === 'Moyen' && (currentStage === 'MATURE' || currentStage === 'FLORAISON')) ? 0.8 : 1; const fertilizerBonus = (1 + (ps.fertilizerLevel / 150));
                const effectiveTimeAliveMs = (now - ps.timeBorn) * growthRate * fertilizerBonus * potFactor * healthFactor; const currentTimeThreshold = stageData.t; const nextTimeThreshold = nextStageData.t; const stageDuration = nextTimeThreshold - currentTimeThreshold;
                if (stageDuration > 0) { const timeSpentTowardsNext = effectiveTimeAliveMs - currentTimeThreshold; ps.growthProgress = Math.max(0, Math.min(100, (timeSpentTowardsNext / stageDuration) * 100)); } else { ps.growthProgress = 0; }
                if (effectiveTimeAliveMs >= nextTimeThreshold) { ps.growthStage = nextStageKey; ps.growthProgress = 0; const newStageInfo = GROWTH_STAGES[ps.growthStage]; addLogEntry("Système", `"${ps.name}" a grandi et est maintenant: ${newStageInfo.n}!`); if (ps.creatorId && ps.creatorId !== "Système") { updatePlayerResources(ps.creatorId, SCORE_PER_GROWTH); if (ps.growthStage === 'FLORAISON') { updatePlayerResources(ps.creatorId, SCORE_PER_FLOWER); addLogEntry("Système", `"${ps.name}" est en fleur! 🌸`); } } plantChanged = true; }
                else if (Math.abs(ps.growthProgress - previousGrowthProgress) > 0.1) { plantChanged = true; }
            } else { ps.growthProgress = 100; if (previousGrowthProgress !== 100) plantChanged = true; }
        } else if (isWilted) { ps.growthProgress = 0; if (previousGrowthProgress !== 0) plantChanged = true; }
        else if (stageData && stageData.t === Infinity) { ps.growthProgress = 100; if (previousGrowthProgress !== 100) plantChanged = true; }
        ps.lastUpdateTime = now; if (plantChanged) { needsBroadcast = true; }
    }
    if (needsBroadcast) { broadcastPlantsUpdate(); }
    if (now - lastSaveTime >= SAVE_INTERVAL) { saveGameState(); }
}


// --- Server Setup & Socket Handling (v7.7) ---
app.use(express.static(__dirname));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

io.on('connection', (socket) => {
    const socketId = socket.id;
    const userId = uuidv4();
    const initialUsername = `Jardinier_${userId.substring(0, 4)}`;

    // Initialize user data (v7.7)
    gameState.users[socketId] = {
        userId: userId, username: initialUsername,
        lastCreateTime: 0, lastWaterAllTime: 0, lastPlantSeedTime: 0, // Added lastPlantSeedTime
        currentQuest: null, questProgressData: {}
    };
    console.log(`User connected: SocketID ${socketId}, UserID ${userId}, Username: ${initialUsername}`);

    // Initialize or update score entry (v7.7)
    if (!gameState.scores[userId]) {
        gameState.scores[userId] = { username: initialUsername, score: 0, coins: 0, seeds: 0 }; // Initialize with seeds
    } else {
        gameState.scores[userId].username = initialUsername;
        gameState.scores[userId].coins = gameState.scores[userId].coins || 0;
        gameState.scores[userId].seeds = gameState.scores[userId].seeds || 0; // Ensure seeds exist on reconnect
    }

    assignNewQuest(socketId);

    // Send initial state (v7.7)
    socket.emit('userId', userId);
    socket.emit('usernameUpdate', initialUsername);
    socket.emit('plantsUpdate', gameState.plants);
    socket.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES));
    socket.emit('leaderboardUpdate', getTopScores());
    socket.emit('questUpdate', gameState.users[socketId].currentQuest);
    socket.emit('eventUpdate', gameState.currentEvent);
    socket.emit('shopItemsUpdate', SHOP_ITEMS);
    broadcastPlayerInfo(socketId); // Sends score, coins, AND seeds

    // --- Handle client events ---

    socket.on('setUsername', (newName) => {
        const user = gameState.users[socketId]; if (!user) return;
        const cleanName = String(newName || '').trim().substring(0, 20);
        if (cleanName && cleanName !== user.username) {
            const oldName = user.username; user.username = cleanName; updateScoreUsername(user.userId, cleanName);
            console.log(`User ${socketId} (${oldName}) set username to: ${cleanName}`);
            addLogEntry("Système", `"${oldName}" est maintenant connu comme "${cleanName}"`);
            broadcastLeaderboard(); socket.emit('usernameUpdate', cleanName);
        }
    });

    // --- Generic Action Handler (v7.7 - Updated harvestSeed) ---
    const actions = {
        waterPlant: { cooldown: 0, score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'), effect: (ps, user, username) => { ps.waterLevel = Math.min(100, ps.waterLevel + WATER_PER_CLICK); ps.health = Math.min(100, ps.health + 1); ps.lastWateredBy = username; }, logMsg: "a arrosé" },
        toggleLight: { cooldown: 0, score: () => 0, effect: (ps, user, username) => { ps.isLightOn = !ps.isLightOn; ps.lastLightToggleBy = username; }, logMsgDynamic: (ps) => `a ${ps.isLightOn ? 'allumé' : 'éteint'} la lumière pour` },
        cleanLeaves: { cooldown: CLEAN_LEAVES_COOLDOWN, score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'), lastActionTimeKey: 'lastCleanTime', effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + CLEAN_LEAVES_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 1); ps.lastCleanedBy = username; }, logMsg: "a nettoyé les feuilles de" },
        gentleMist: { cooldown: MIST_COOLDOWN, score: () => SCORE_PER_MIST * getEventMultiplier('care_score'), lastActionTimeKey: 'lastMistTime', effect: (ps, user, username) => { ps.waterLevel = Math.min(100, ps.waterLevel + MIST_WATER_BOOST); ps.energyLevel = Math.min(100, ps.energyLevel + MIST_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.5); }, logMsg: "a brumisé" },
        fertilizePlant: { cooldown: FERTILIZE_COOLDOWN, score: () => SCORE_PER_ACTION, lastActionTimeKey: 'lastFertilizeTime', effect: (ps, user, username) => { ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + (FERTILIZER_PER_CLICK * getEventMultiplier('fertilizer'))); ps.health = Math.min(100, ps.health + 2); ps.lastFertilizedBy = username; }, logMsg: "a fertilisé" },
        applyPesticide: { cooldown: PESTICIDE_COOLDOWN, score: () => SCORE_PER_ACTION, lastActionTimeKey: 'lastPesticideTime', condition: (ps) => ps.pestLevel > 5, effect: (ps, user, username) => { ps.pestLevel = Math.max(0, ps.pestLevel - PESTICIDE_EFFECT); ps.lastPesticideBy = username; }, logMsg: "a appliqué du pesticide sur" },
        prunePlant: { cooldown: PRUNE_COOLDOWN, score: () => SCORE_PER_ACTION, lastActionTimeKey: 'lastPruneTime', condition: (ps) => GROWTH_STAGES[ps.growthStage]?.p, effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + PRUNE_HEALTH_BOOST); ps.health = Math.min(100, ps.health + PRUNE_HEALTH_BOOST); ps.lastPrunedBy = username; }, logMsg: "a taillé" },
        repotPlant: { cooldown: REPOT_COOLDOWN, score: () => SCORE_PER_ACTION * 2, lastActionTimeKey: 'lastRepotTime', condition: (ps) => GROWTH_STAGES[ps.growthStage]?.r && ps.potSize !== 'Large', effect: (ps, user, username) => { const oldSize = ps.potSize; if (oldSize === 'Petit') ps.potSize = 'Moyen'; else if (oldSize === 'Moyen') ps.potSize = 'Large'; ps.fertilizerLevel = Math.max(0, ps.fertilizerLevel - 20); ps.health = Math.min(100, ps.health + 10); ps.lastRepottedBy = username; }, logMsgDynamic: (ps) => `a rempoté dans un pot ${ps.potSize}` },
        harvestSeed: { // Updated v7.7
            cooldown: HARVEST_COOLDOWN,
            score: () => SCORE_PER_SEED_HARVEST, // Score for harvesting
            coins: () => COINS_PER_HARVEST * getEventMultiplier('harvest_coins'), // Coins for harvesting
            seeds: () => 1, // Gain 1 seed
            lastActionTimeKey: 'lastHarvestTime',
            condition: (ps) => ps.growthStage === 'FLORAISON',
            effect: (ps, user, username) => { /* No direct effect on plant state, resources handled separately */ },
            logMsg: "a récolté une graine de"
        },
        talkToPlant: { cooldown: TALK_COOLDOWN, score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'), lastActionTimeKey: 'lastTalkTime', effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + TALK_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.2); }, logMsg: "a parlé gentiment à" },
        playMusic: { cooldown: PLAY_MUSIC_COOLDOWN, score: () => SCORE_PER_ACTION, lastActionTimeKey: 'lastPlayMusicTime', condition: (ps) => !ps.isMusicPlaying, effect: (ps, user, username) => { ps.isMusicPlaying = true; ps.musicEndTime = getCurrentTimestamp() + MUSIC_DURATION; ps.lastMusicBy = username; }, logMsg: "a joué de la musique pour" },
        observePlant: { cooldown: OBSERVE_COOLDOWN, score: () => SCORE_PER_OBSERVE, lastActionTimeKey: 'lastObserveTime', effect: (ps, user, username, socket) => { const char = ps.characteristics || {}; let observations = []; if (char.waterTolerance === 'Basse') observations.push("Semble sensible aux excès/manques d'eau."); if (char.waterTolerance === 'Haute') observations.push("Tolère bien les variations d'eau."); if (char.lightTolerance === 'Basse') observations.push("Préfère une lumière stable."); if (char.lightTolerance === 'Haute') observations.push("S'adapte bien à différentes lumières."); if ((char.waterNeedFactor || 1) < 0.9) observations.push("A besoin de moins d'eau que la moyenne."); if ((char.waterNeedFactor || 1) > 1.1) observations.push("A besoin de plus d'eau que la moyenne."); if ((char.lightNeedFactor || 1) < 0.9) observations.push("A besoin de moins de lumière."); if ((char.lightNeedFactor || 1) > 1.1) observations.push("A besoin de plus de lumière."); if ((char.pestResistanceFactor || 1) < 0.9) observations.push("Est assez sensible aux nuisibles."); if ((char.pestResistanceFactor || 1) > 1.1) observations.push("Est plutôt résistante aux nuisibles."); if ((char.envResistanceFactor || 1) < 0.9) observations.push("Sensible aux changements d'environnement."); if ((char.envResistanceFactor || 1) > 1.1) observations.push("Résiste bien aux changements d'environnement."); observations.push(`Feuilles: ${char.leafShape || 'Forme inconnue'}.`); if (ps.growthStage === 'FLORAISON') observations.push(`Fleurs: Couleur ${char.flowerColor || 'inconnue'}.`); if (char.rareTrait) { const traitInfo = RARE_TRAITS.find(t => t.n === char.rareTrait); observations.push(`Trait Spécial: ${char.rareTrait}! ${traitInfo?.d || ''}`); } const feedbackText = observations.length > 0 ? observations.join(' ') : "Semble être une plante tout à fait normale."; socket.emit('plantObservation', { plantId: ps.plantId, text: feedbackText }); }, logMsg: "a observé" },
        checkEnvironment: { cooldown: ENV_CHECK_COOLDOWN, score: () => 0, lastActionTimeKey: 'lastCheckEnvTime', effect: (ps, user, username) => { /* No direct effect */ }, logMsgDynamic: (ps) => `a vérifié l'environnement (${ps.environmentStatus}) de` }
    };

    // Register listeners for each generic action
    for (const actionName in actions) {
        socket.on(actionName, (data) => {
            const user = gameState.users[socketId]; if (!user) return;
            const userId = user.userId; const username = user.username;
            const plantId = data?.plantId; const ps = gameState.plants[plantId];
            if (!ps) { socket.emit('actionFeedback', { success: false, message: "Plante introuvable." }); return; }
            const actionConfig = actions[actionName]; const now = getCurrentTimestamp();

            // Cooldown Check
            if (actionConfig.cooldown > 0 && actionConfig.lastActionTimeKey) { if ((now - (ps[actionConfig.lastActionTimeKey] || 0)) < actionConfig.cooldown) { return; } }
            // Health Check
            if (ps.health <= 0) { addLogEntry(username, `a essayé ${actionName} sur ${ps.name} (flétrie)`, null); socket.emit('actionFeedback', { success: false, message: "Cette plante est flétrie." }); return; }
            // Condition Check
            if (actionConfig.condition && !actionConfig.condition(ps)) { socket.emit('actionFeedback', { success: false, message: "Action impossible dans ces conditions." }); addLogEntry(username, `a essayé ${actionName} sur ${ps.name} (condition échouée)`, null); return; }

            // Execute Action
            actionConfig.effect(ps, user, username, socket);
            ps.lastUpdateTime = now;
            if (actionConfig.lastActionTimeKey) { ps[actionConfig.lastActionTimeKey] = now; }

            // Update Resources (v7.7)
            const scoreToAdd = typeof actionConfig.score === 'function' ? actionConfig.score() : (actionConfig.score || 0);
            const coinsToAdd = typeof actionConfig.coins === 'function' ? actionConfig.coins() : (actionConfig.coins || 0);
            const seedsToAdd = typeof actionConfig.seeds === 'function' ? actionConfig.seeds() : (actionConfig.seeds || 0); // Get seeds to add
            if (scoreToAdd > 0 || coinsToAdd > 0 || seedsToAdd > 0) {
                updatePlayerResources(userId, scoreToAdd, coinsToAdd, seedsToAdd); // Use updated function
            }

            checkQuestProgress(socketId, actionName, plantId);
            const logMessage = actionConfig.logMsgDynamic ? actionConfig.logMsgDynamic(ps) : actionConfig.logMsg;
            addLogEntry(username, logMessage, ps.name);
            broadcastPlantsUpdate();
            broadcastPlayerInfo(socketId); // Sends updated score/coins/seeds
        });
    }

    // --- Specific Actions Not Covered by Generic Handler (v7.7) ---

    socket.on('createPlant', (data) => { // Creates a standard plant
        const user = gameState.users[socketId]; if (!user) return; const now = getCurrentTimestamp();
        if (now - user.lastCreateTime < CREATE_PLANT_COOLDOWN) { addLogEntry(user.username, "a essayé de créer une plante (cooldown)"); socket.emit('actionFeedback', { success: false, message: "Vous devez attendre avant de créer une nouvelle plante." }); return; }
        if (Object.keys(gameState.plants).length >= MAX_PLANTS) { addLogEntry(user.username, "a essayé de créer une plante (max atteint)"); socket.emit('actionFeedback', { success: false, message: "Le jardin est plein ! Impossible de créer plus de plantes." }); return; }
        const plantNameRequest = data?.plantName;
        const newPlantId = createPlant(user.userId, user.username, plantNameRequest);
        if (newPlantId) { user.lastCreateTime = now; socket.emit('actionFeedback', { success: true, message: `Nouvelle plante "${gameState.plants[newPlantId].name}" créée avec succès !`, sound: 'create' }); }
        else { socket.emit('actionFeedback', { success: false, message: "Erreur lors de la création de la plante." }); }
    });

    // NEW: Handle planting a harvested seed (v7.7)
    socket.on('plantSeed', () => {
        const user = gameState.users[socketId]; if (!user) return; const now = getCurrentTimestamp();
        const playerScore = gameState.scores[user.userId];

        // Check cooldown
        if (now - user.lastPlantSeedTime < PLANT_SEED_COOLDOWN) { addLogEntry(user.username, "a essayé de planter une graine (cooldown)"); socket.emit('actionFeedback', { success: false, message: "Vous devez attendre avant de planter une autre graine." }); return; }
        // Check if user has seeds
        if (!playerScore || (playerScore.seeds || 0) <= 0) { addLogEntry(user.username, "a essayé de planter une graine (aucune graine)"); socket.emit('actionFeedback', { success: false, message: "Vous n'avez pas de graines à planter." }); return; }
        // Check global plant limit
        if (Object.keys(gameState.plants).length >= MAX_PLANTS) { addLogEntry(user.username, "a essayé de planter une graine (max atteint)"); socket.emit('actionFeedback', { success: false, message: "Le jardin est plein ! Impossible de planter plus de graines." }); return; }

        // Consume seed, create plant, update cooldown
        updatePlayerResources(user.userId, SCORE_PER_SEED_PLANT, 0, -1); // Consume 1 seed, give planting score
        const plantNameRequest = `Pousse de ${user.username}`; // Default name for planted seed
        const newPlantId = createPlant(user.userId, user.username, plantNameRequest); // Create a standard plant for now

        if (newPlantId) {
            user.lastPlantSeedTime = now; // Update cooldown timestamp
            addLogEntry(user.username, `a planté une graine récoltée: ${gameState.plants[newPlantId].name}`);
            socket.emit('actionFeedback', { success: true, message: `Graine plantée avec succès: "${gameState.plants[newPlantId].name}" !`, sound: 'plantSeed' });
            broadcastPlayerInfo(socketId); // Update seed count display
        } else {
            // Refund seed if creation failed (should be rare)
            updatePlayerResources(user.userId, -SCORE_PER_SEED_PLANT, 0, 1);
            socket.emit('actionFeedback', { success: false, message: "Erreur lors de la plantation de la graine." });
            broadcastPlayerInfo(socketId); // Update seed count display (refunded)
        }
    });

    socket.on('waterAllPlants', () => {
        const user = gameState.users[socketId]; if (!user) return; const now = getCurrentTimestamp();
        if (now - user.lastWaterAllTime < WATER_ALL_COOLDOWN) { addLogEntry(user.username, "a essayé 'Tout Arroser' (cooldown)"); socket.emit('actionFeedback', { success: false, message: "Cooldown 'Tout Arroser'." }); return; }
        let wateredCount = 0; let totalScore = 0; let needsUpdate = false; const careScoreMultiplier = getEventMultiplier('care_score');
        for (const plantId in gameState.plants) { const ps = gameState.plants[plantId]; if (ps && ps.health > 0 && ps.waterLevel < 95) { ps.waterLevel = Math.min(100, ps.waterLevel + WATER_ALL_BOOST); ps.lastUpdateTime = now; ps.lastWateredBy = user.username; wateredCount++; totalScore += SCORE_PER_ACTION * careScoreMultiplier; needsUpdate = true; } }
        if (wateredCount > 0) { user.lastWaterAllTime = now; updatePlayerResources(user.userId, totalScore); addLogEntry(user.username, `a utilisé 'Tout Arroser' (${wateredCount} plante(s))`); if (needsUpdate) broadcastPlantsUpdate(); broadcastPlayerInfo(socketId); socket.emit('actionFeedback', { success: true, message: `${wateredCount} plante(s) arrosée(s) !`, sound: 'water' }); }
        else { addLogEntry(user.username, "a essayé 'Tout Arroser' (aucune plante à arroser)"); socket.emit('actionFeedback', { success: false, message: "Aucune plante n'avait besoin d'être arrosée." }); }
    });

    socket.on('buyItem', (data) => { // Unchanged logic from v7.3, but uses updatePlayerResources
         const user = gameState.users[socketId]; if (!user) return; const userId = user.userId; const username = user.username;
         const itemId = data?.itemId; const targetPlantId = data?.plantId; const item = SHOP_ITEMS[itemId]; const playerScore = gameState.scores[userId];
         if (!item) { socket.emit('actionFeedback', { success: false, message: "Objet inconnu dans la boutique." }); return; }
         if (!playerScore || (playerScore.coins || 0) < item.price) { socket.emit('actionFeedback', { success: false, message: "Pièces insuffisantes pour acheter cet objet." }); return; }
         console.log(`${username} trying to buy ${item.name} (${itemId}) for ${item.price} coins.`);
         updatePlayerResources(userId, 0, -item.price); // Deduct cost
         let purchaseSuccessful = false; let feedbackMsg = ''; let feedbackSound = 'error';
         try {
             if (item.type === 'seed') { if (Object.keys(gameState.plants).length >= MAX_PLANTS) { feedbackMsg = "Achat échoué: le jardin est plein."; updatePlayerResources(userId, 0, item.price); } else { const newPlantId = createPlant(userId, username, `Graine ${item.name}`); if (newPlantId) { feedbackMsg = `${item.name} achetée et plantée !`; feedbackSound = 'buy'; purchaseSuccessful = true; addLogEntry(username, `a acheté et planté: ${item.name}`); } else { feedbackMsg = "Achat échoué lors de la plantation."; updatePlayerResources(userId, 0, item.price); } } }
             else if (item.type === 'cosmetic') { if (itemId.startsWith('pot_') && targetPlantId && gameState.plants[targetPlantId]) { gameState.plants[targetPlantId].potColor = item.value; feedbackMsg = `${item.name} appliqué à ${gameState.plants[targetPlantId].name} !`; feedbackSound = 'buy'; purchaseSuccessful = true; addLogEntry(username, `a acheté ${item.name} pour ${gameState.plants[targetPlantId].name}`); broadcastPlantsUpdate(); } else { feedbackMsg = "Achat échoué: Plante cible invalide pour ce cosmétique."; updatePlayerResources(userId, 0, item.price); } }
             else if (item.type === 'consumable' || item.type === 'boost') { const ps = gameState.plants[targetPlantId]; if (!ps) { feedbackMsg = "Achat échoué: Plante cible invalide."; updatePlayerResources(userId, 0, item.price); } else if (ps.health <= 0) { feedbackMsg = "Impossible d'utiliser sur une plante flétrie."; updatePlayerResources(userId, 0, item.price); } else { if (item.effect === 'pesticide' && item.amount) { ps.pestLevel = Math.max(0, ps.pestLevel - item.amount); feedbackMsg = `${item.name} utilisé sur ${ps.name} !`; feedbackSound = 'buy'; purchaseSuccessful = true; addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`); broadcastPlantsUpdate(); } else if (item.effect === 'fertilizer' && item.amount) { ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + item.amount); feedbackMsg = `${item.name} utilisé sur ${ps.name} !`; feedbackSound = 'buy'; purchaseSuccessful = true; addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`); broadcastPlantsUpdate(); } else { feedbackMsg = "Effet d'objet inconnu ou non implémenté."; updatePlayerResources(userId, 0, item.price); } } }
             else { feedbackMsg = "Type d'objet inconnu."; updatePlayerResources(userId, 0, item.price); }
         } catch (error) { console.error(`Error processing purchase for ${username} item ${itemId}:`, error); feedbackMsg = "Erreur lors de l'application de l'objet."; updatePlayerResources(userId, 0, item.price); }
         socket.emit('actionFeedback', { success: purchaseSuccessful, message: feedbackMsg, sound: feedbackSound });
         broadcastPlayerInfo(socketId); if (purchaseSuccessful) { saveGameState(); }
     });

    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: SocketID ${socketId}, Reason: ${reason}`);
        const user = gameState.users[socketId];
        if (user) { addLogEntry("Système", `"${user.username}" s'est déconnecté.`); delete gameState.users[socketId]; }
    });
});

// --- Leaderboard Utility (Unchanged) ---
function getTopScores(count = 10) {
    return Object.entries(gameState.scores)
        .map(([userId, data]) => ({ userId: userId, username: data.username || 'Anonyme', score: data.score || 0, coins: data.coins || 0, seeds: data.seeds || 0 })) // Include seeds here if you want them on leaderboard
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`------------------------------------------`);
    console.log(` 🌱 Jardin Communautaire Server v7.7 🌱 `); // Updated version
    console.log(`    Server listening on port ${PORT}`);
    console.log(`------------------------------------------`);
    loadGameState();
    if (gameLoopTimer) clearInterval(gameLoopTimer); if (leaderboardUpdateTimer) clearInterval(leaderboardUpdateTimer); if (eventTimer) clearInterval(eventTimer);
    gameLoopTimer = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    leaderboardUpdateTimer = setInterval(broadcastLeaderboard, LEADERBOARD_UPDATE_INTERVAL);
    eventTimer = setInterval(checkEvent, EVENT_CHECK_INTERVAL);
    console.log("Game loops (Game, Leaderboard, Events) started.");
});

// --- Graceful Shutdown (Unchanged) ---
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    if (gameLoopTimer) clearInterval(gameLoopTimer); if (leaderboardUpdateTimer) clearInterval(leaderboardUpdateTimer); if (eventTimer) clearInterval(eventTimer); console.log("Game loops stopped.");
    console.log("Performing final save...");
    try { const dataToSave = { plants: gameState.plants, scores: gameState.scores, logs: gameState.logs, currentEvent: gameState.currentEvent }; fs.writeFileSync(GAMESTATE_FILE, JSON.stringify(dataToSave), 'utf8'); console.log("Final game state saved successfully."); }
    catch (error) { console.error("Error during final save:", error); }
    server.close(() => { console.log("Server closed."); process.exit(0); });
});
