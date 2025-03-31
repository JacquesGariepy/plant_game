// server.js (v7 - Événements, Sons, Aging)
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
const SAVE_INTERVAL = 20 * 1000;
const GAME_LOOP_INTERVAL = 1000;
const LEADERBOARD_UPDATE_INTERVAL = 10 * 1000;
const EVENT_CHECK_INTERVAL = 5 * 60 * 1000; // Check/change event every 5 minutes

// --- Game Constants ---
const MAX_LOG_ENTRIES = 30; const MAX_PLANTS = 50;
// Action effects & Costs
const WATER_PER_CLICK = 30; const FERTILIZER_PER_CLICK = 40; const PESTICIDE_EFFECT = 50;
const PESTICIDE_STRONG_EFFECT = 80; // New item effect
const MUSIC_DURATION = 2 * 60 * 1000; const CLEAN_LEAVES_ENERGY_BOOST = 3; const PRUNE_HEALTH_BOOST = 5;
const TALK_ENERGY_BOOST = 5; const MIST_WATER_BOOST = 5; const MIST_ENERGY_BOOST = 2;
const WATER_ALL_BOOST = 8;
const HEALTH_REGEN_RATE = 1; const HEALTH_LOSS_RATE = 3;
const AGING_HEALTH_LOSS_RATE = 1; // Additional health loss per hour for neglected mature plants
// Rates per hour
const WATER_DEPLETION_RATE_PER_HOUR = 4; const ENERGY_GAIN_RATE_PER_HOUR = 15; const ENERGY_DEPLETION_RATE_PER_HOUR = 8;
const FERTILIZER_DEPLETION_RATE_PER_HOUR = 3; const PEST_INCREASE_RATE_PER_HOUR = 2; const PEST_DECREASE_RATE_PER_HOUR = 1;
const ENVIRONMENT_CHANGE_CHANCE = 0.05;
// Cooldowns (ms)
const TALK_COOLDOWN = 60*1000; const FERTILIZE_COOLDOWN = 5*60*1000; const PESTICIDE_COOLDOWN = 10*60*1000;
const REPOT_COOLDOWN = 12*60*60*1000; const PLAY_MUSIC_COOLDOWN = 15*60*1000; const CLEAN_LEAVES_COOLDOWN = 2*60*1000;
const PRUNE_COOLDOWN = 6*60*60*1000; const ENV_CHECK_COOLDOWN = 30*1000; const CREATE_PLANT_COOLDOWN = 1*60*1000;
const OBSERVE_COOLDOWN = 1*60*1000; const HARVEST_COOLDOWN = 4*60*60*1000; const MIST_COOLDOWN = 30*1000;
const WATER_ALL_COOLDOWN = 5 * 60 * 1000;
// Scoring & Currency
const SCORE_PER_ACTION = 1; const SCORE_PER_GROWTH = 10; const SCORE_PER_FLOWER = 50;
const SCORE_PER_SEED = 25; const SCORE_PER_OBSERVE = 2; const SCORE_PER_MIST = 1;
const COINS_PER_QUEST = 50; const COINS_PER_HARVEST = 10;

// Shop Items V7
const SHOP_ITEMS = {
    'seed_basic': { name: "Graine Standard", price: 100, type: 'seed', description: "Une graine simple pour commencer." },
    'fertilizer_boost': { name: "Engrais Rapide", price: 75, type: 'boost', effect: 'fertilizer', amount: 50, duration: 1 * 36e5, description: "Boost temporaire d'engrais." }, // 1 hour boost
    'pesticide_strong': { name: "Pesticide Puissant", price: 150, type: 'consumable', effect: 'pesticide', amount: PESTICIDE_STRONG_EFFECT, description: "Élimine plus de nuisibles." },
    'pot_red': { name: "Pot Rouge", price: 50, type: 'cosmetic', value: '#e57373', description: "Change la couleur du pot." },
    'pot_blue': { name: "Pot Bleu", price: 50, type: 'cosmetic', value: '#64b5f6', description: "Change la couleur du pot." },
    'pot_yellow': { name: "Pot Jaune", price: 50, type: 'cosmetic', value: '#fff176', description: "Change la couleur du pot." },
    'pot_purple': { name: "Pot Violet", price: 75, type: 'cosmetic', value: '#ba68c8', description: "Change la couleur du pot." },
    'pot_white': { name: "Pot Blanc", price: 25, type: 'cosmetic', value: '#ffffff', description: "Change la couleur du pot." },
    'pot_black': { name: "Pot Noir", price: 75, type: 'cosmetic', value: '#424242', description: "Change la couleur du pot." },
};

// --- Characteristics Definitions ---
const GROWTH_STAGES = { GRAINE:{n:"Graine",i:"fa-seedling",nt:'POUSSE',t:0,r:!1,p:!1},POUSSE:{n:"Pousse",i:"fa-seedling",nt:'JEUNE',t:1*36e5,r:!1,p:!1},JEUNE:{n:"Jeune Plante",i:"fa-leaf",nt:'MATURE',t:6*36e5,r:!0,p:!1},MATURE:{n:"Plante Mature",i:"fa-spa",nt:'FLORAISON',t:24*36e5,r:!0,p:!0},FLORAISON:{n:"En Fleur",i:"fa-fan",nt:null,t:Infinity,r:!0,p:!0}}; // Minified
const POT_SIZES = ['Petit', 'Moyen', 'Large'];
const ENVIRONMENT_STATUSES = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide', 'Infesté de nuisibles'];
const PLANT_COLORS = ['#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7'];
const LEAF_SHAPES = ['Ovale', 'Pointue', 'Dentelée', 'Lobée', 'Cordée'];
const FLOWER_COLORS = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#ffffff', '#ffeb3b', '#ff9800'];
const TOLERANCE_LEVELS = ['Basse', 'Moyenne', 'Haute'];
const RARE_TRAITS = [{n:'Feuilles Scintillantes',d:'Ses feuilles brillent.'},{n:'Lueur Nocturne',d:'Émet une douce lueur.'},{n:'Parfum Envoûtant',d:'Dégage un parfum agréable.'},{n:'Mélodie Murmurante',d:'Semble fredonner.'},{n:'Nectar Précieux',d:'Produit un nectar rare.'}];
const RARE_TRAIT_CHANCE = 0.03;

// --- Quest Definitions ---
const QUESTS = [ /* ... (inchangé pour l'instant, pourrait être étendu) ... */ { id: 'water3', description: "Arroser 3 plantes différentes", target: 3, action: 'waterPlant', uniqueTarget: true, reward: { score: 10, coins: COINS_PER_QUEST } }, { id: 'clean5', description: "Nettoyer les feuilles de 5 plantes", target: 5, action: 'cleanLeaves', reward: { score: 15, coins: COINS_PER_QUEST } }, { id: 'observe2', description: "Observer 2 plantes", target: 2, action: 'observePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } }, { id: 'fertilize1', description: "Fertiliser 1 plante", target: 1, action: 'fertilizePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } }, { id: 'mist4', description: "Brumiser 4 fois", target: 4, action: 'gentleMist', reward: { score: 8, coins: COINS_PER_QUEST / 2 } }, ];

// --- Event Definitions ---
const EVENTS = [
    { id: 'fertilizer_bonus', name: "Fertilisation Efficace !", duration: 30 * 60 * 1000, effectMultiplier: { fertilizer: 1.5 }, description: "L'engrais est 50% plus efficace." },
    { id: 'growth_spurt', name: "Poussée de Croissance !", duration: 1 * 60 * 60 * 1000, effectMultiplier: { growth: 1.3 }, description: "Les plantes grandissent 30% plus vite." },
    { id: 'pest_resistance', name: "Résistance aux Nuisibles", duration: 2 * 60 * 60 * 1000, effectMultiplier: { pest_resist: 1.5 }, description: "Les plantes résistent mieux aux nuisibles." },
    { id: 'harvest_bounty', name: "Récolte Abondante", duration: 1 * 60 * 60 * 1000, effectMultiplier: { harvest_coins: 2 }, description: "Récolter des graines rapporte double pièces." },
    { id: 'care_bonus', name: "Soins Récompensés", duration: 45 * 60 * 1000, effectMultiplier: { care_score: 2 }, description: "Les actions de soin de base rapportent double score." },
];
const EVENT_CHANCE = 0.15; // Chance (per check interval) that a new event starts if none is active

// --- Game State Structure ---
let gameState = {
    plants: {}, scores: {}, users: {}, logs: [],
    currentEvent: null // { id, name, endTime, description }
};
let lastSaveTime = 0;
let gameLoopTimer = null;
let leaderboardUpdateTimer = null;
let eventTimer = null;

// --- Utility Functions ---
function getCurrentTimestamp() { return Date.now(); }
function randomInRange(min, max) { return Math.random() * (max - min) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getUserId(socketId) { return gameState.users[socketId]?.userId; }
function getUsername(userId) { if (!userId) return 'Inconnu'; if (gameState.scores[userId]) return gameState.scores[userId].username; for(const sId in gameState.users){if(gameState.users[sId].userId === userId) return gameState.users[sId].username;} return 'Anonyme'; }
function getRandomEnvStatus(currentPestLevel) { const pc = Math.min(0.5, currentPestLevel / 150); if(Math.random() < pc) return 'Infesté de nuisibles'; const s = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide']; return s[Math.floor(Math.random() * s.length)]; }
function generatePlantCharacteristics() { let rt=null;if(Math.random()<RARE_TRAIT_CHANCE){rt=randomChoice(RARE_TRAITS);} return {waterNeedFactor:randomInRange(.8,1.2),lightNeedFactor:randomInRange(.8,1.2),fertilizerNeedFactor:randomInRange(.7,1.3),baseColor:randomChoice(PLANT_COLORS),leafShape:randomChoice(LEAF_SHAPES),flowerColor:randomChoice(FLOWER_COLORS),growthRateFactor:randomInRange(.9,1.1),pestResistanceFactor:randomInRange(.8,1.2),envResistanceFactor:randomInRange(.8,1.2),lifespanFactor:randomInRange(.9,1.1),waterTolerance:randomChoice(TOLERANCE_LEVELS),lightTolerance:randomChoice(TOLERANCE_LEVELS),rareTrait:rt?rt.n:null,}; }

// --- Game State Management ---
function initializeGameState() { console.log("Init state v7..."); const now = getCurrentTimestamp(); gameState.plants = {}; gameState.scores = {}; gameState.users = {}; gameState.logs = []; gameState.currentEvent = null; createPlant("Système", "Gaïa Prima", "Système"); saveGameState(); }
function loadGameState() { try { if (fs.existsSync(GAMESTATE_FILE)) { const data = fs.readFileSync(GAMESTATE_FILE, 'utf8'); const loadedData = JSON.parse(data); gameState.plants = loadedData.plants || {}; gameState.scores = loadedData.scores || {}; gameState.logs = Array.isArray(loadedData.logs) ? loadedData.logs.slice(0, MAX_LOG_ENTRIES * 5) : []; gameState.currentEvent = loadedData.currentEvent || null; gameState.users = {}; for (const userId in gameState.scores) { gameState.scores[userId].coins = gameState.scores[userId].coins || 0; } let plantCount = 0; for (const plantId in gameState.plants) { plantCount++; const plant=gameState.plants[plantId]; const defaults = { health: 100, potColor: '#A1887F', waterLevel: 100, energyLevel: 100, fertilizerLevel: 0, pestLevel: 0, isLightOn: !1, growthStage: 'GRAINE', potSize: 'Petit', isMusicPlaying: !1, musicEndTime: 0, environmentStatus: 'Optimal', timeBorn: getCurrentTimestamp(), lastUpdateTime: getCurrentTimestamp(), lastWateredBy: "?", lastLightToggleBy: "?", lastFertilizedBy: "?", lastPesticideBy: "?", lastRepottedBy: "?", lastMusicBy: "?", lastCleanedBy: "?", lastPrunedBy: "?", lastTalkTime: 0, lastFertilizeTime: 0, lastPesticideTime: 0, lastRepotTime: 0, lastPlayMusicTime: 0, lastCleanTime: 0, lastPruneTime: 0, lastCheckEnvTime: 0, lastObserveTime: 0, lastHarvestTime: 0, lastMistTime: 0 }; for (const key in defaults) { if (plant[key] === undefined || plant[key] === null) plant[key] = defaults[key]; } if (!plant.characteristics || typeof plant.characteristics !== 'object') plant.characteristics = generatePlantCharacteristics(); else { const charDefaults = { waterNeedFactor: 1, lightNeedFactor: 1, fertilizerNeedFactor: 1, baseColor: PLANT_COLORS[0], leafShape: LEAF_SHAPES[0], flowerColor: FLOWER_COLORS[0], growthRateFactor: 1, pestResistanceFactor: 1, envResistanceFactor: 1, lifespanFactor: 1, waterTolerance: 'Moyenne', lightTolerance: 'Moyenne', rareTrait: null }; for (const charKey in charDefaults) { if (plant.characteristics[charKey] === undefined || plant.characteristics[charKey] === null) plant.characteristics[charKey] = charDefaults[charKey]; } } if (!GROWTH_STAGES[plant.growthStage]) plant.growthStage = 'GRAINE'; } if (plantCount === 0) { console.log("No plants loaded."); createPlant("Système", "Gaïa Prima", "Système"); } console.log(`State loaded. ${plantCount} plants, ${Object.keys(gameState.scores).length} scores.`); } else { initializeGameState(); } } catch (error) { console.error("Load Error:", error); initializeGameState(); } }
function saveGameState() { const now=getCurrentTimestamp();if(now-lastSaveTime<5000&&lastSaveTime!==0)return;lastSaveTime=now;console.log("Saving...");try{const dts={plants:gameState.plants,scores:gameState.scores,logs:gameState.logs.slice(0,MAX_LOG_ENTRIES*5),currentEvent:gameState.currentEvent};fs.writeFileSync(GAMESTATE_FILE,JSON.stringify(dts),'utf8');}catch(e){console.error("Save Error:",e);}}
function addLogEntry(user, action, plantName = null) { const la=plantName?`${action} (${plantName})`:action;const nl={user:user,action:la,timestamp:getCurrentTimestamp()};gameState.logs.unshift(nl);if(gameState.logs.length>MAX_LOG_ENTRIES*5){gameState.logs=gameState.logs.slice(0,MAX_LOG_ENTRIES*5);} broadcastLogs(); saveGameState(); }
function addScore(userId, scorePoints = 0, coinAmount = 0) { if(!userId||(scorePoints<=0&&coinAmount<=0))return;if(!gameState.scores[userId]){let un=getUsername(userId);gameState.scores[userId]={username:un,score:0,coins:0};}gameState.scores[userId].score+=scorePoints;gameState.scores[userId].coins=(gameState.scores[userId].coins||0)+coinAmount;console.log(`Score/Coins: ${userId}: ${gameState.scores[userId].score} / ${gameState.scores[userId].coins}c`);}
function updateScoreUsername(userId, newUsername) { if(gameState.scores[userId]){gameState.scores[userId].username=newUsername;}else{gameState.scores[userId]={username:newUsername,score:0,coins:0};}}

// --- Quest Management ---
function assignNewQuest(socketId) { const user = gameState.users[socketId]; if (!user) return; const availableQuests = QUESTS.filter(q => q.id !== user.currentQuest?.id); const newQuestTemplate = randomChoice(availableQuests.length > 0 ? availableQuests : QUESTS); user.currentQuest = { id: newQuestTemplate.id, description: newQuestTemplate.description, progress: 0, target: newQuestTemplate.target, action: newQuestTemplate.action, reward: newQuestTemplate.reward, completed: false, uniqueTarget: newQuestTemplate.uniqueTarget || false }; user.questProgressData = {}; console.log(`Quest assigned '${user.currentQuest.id}' to ${user.username}`); io.to(socketId).emit('questUpdate', user.currentQuest); }
function checkQuestProgress(socketId, actionName, plantId = null) { const user = gameState.users[socketId]; if (!user || !user.currentQuest || user.currentQuest.completed) return; const quest = user.currentQuest; if (quest.action === actionName) { let progressMade = false; if (quest.uniqueTarget && plantId) { if (!user.questProgressData[plantId]) { user.questProgressData[plantId] = true; quest.progress++; progressMade = true; } } else if (!quest.uniqueTarget) { quest.progress++; progressMade = true; } if (progressMade) { console.log(`Quest '${quest.id}' prog ${user.username}: ${quest.progress}/${quest.target}`); if (quest.progress >= quest.target) { quest.completed = true; addScore(user.userId, quest.reward.score, quest.reward.coins); addLogEntry(user.username, `a complété: ${quest.description}! (+${quest.reward.coins}p)`); io.to(socketId).emit('actionFeedback', { success: true, message: `Quête complétée ! +${quest.reward.coins}p !`, sound: 'questComplete' }); setTimeout(() => assignNewQuest(socketId), 3000); } io.to(socketId).emit('questUpdate', quest); } } }

// --- Event Management ---
function checkEvent() {
    const now = getCurrentTimestamp();
    if (gameState.currentEvent && now >= gameState.currentEvent.endTime) {
        console.log(`Event ended: ${gameState.currentEvent.name}`);
        addLogEntry("Système", `L'événement "${gameState.currentEvent.name}" est terminé.`);
        gameState.currentEvent = null;
        broadcastEventUpdate();
        saveGameState();
    } else if (!gameState.currentEvent) {
        if (Math.random() < EVENT_CHANCE) {
            startRandomEvent();
        }
    }
}
function startRandomEvent() {
    const eventTemplate = randomChoice(EVENTS);
    const now = getCurrentTimestamp();
    gameState.currentEvent = {
        id: eventTemplate.id,
        name: eventTemplate.name,
        description: eventTemplate.description,
        endTime: now + eventTemplate.duration,
        effectMultiplier: eventTemplate.effectMultiplier || {}
    };
    console.log(`Event started: ${gameState.currentEvent.name}`);
    addLogEntry("Système", `Événement démarré : ${gameState.currentEvent.name} (${gameState.currentEvent.description})`);
    broadcastEventUpdate();
    saveGameState();
}
function getEventMultiplier(effectType) {
    return gameState.currentEvent?.effectMultiplier?.[effectType] || 1;
}

// --- Broadcasting ---
function broadcastPlantsUpdate() { io.emit('plantsUpdate', gameState.plants); }
function broadcastLogs() { io.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES)); }
function broadcastLeaderboard() { const ss=Object.entries(gameState.scores).map(([uid,d])=>({userId:uid,username:d.username,score:d.score,coins:d.coins||0})).sort((a,b)=>b.score-a.score).slice(0,10);io.emit('leaderboardUpdate',ss);}

function broadcastPlayerInfo(socketId) {
    const user = gameState.users[socketId];
    const scoreData = gameState.scores[user?.userId];
    if (user && scoreData) {
        // CORRECTED LINE: Use io.to(socketId)
        io.to(socketId).emit('playerInfoUpdate', {
            username: scoreData.username,
            score: scoreData.score,
            coins: scoreData.coins
        });
    }
}
function broadcastEventUpdate() { io.emit('eventUpdate', gameState.currentEvent); } // Send event status

// --- Plant Creation ---
function createPlant(creatorId, creatorName, plantNameRequest = null) { if (Object.keys(gameState.plants).length >= MAX_PLANTS) { console.log("Max plantes"); return null; } const now = getCurrentTimestamp(); const plantId = uuidv4(); const characteristics = generatePlantCharacteristics(); const safeName = String(plantNameRequest || `Plante de ${creatorName}`).trim().substring(0, 30) || `Plante_${plantId.substring(0,4)}`; const newPlant = { plantId: plantId, name: safeName, creatorId: creatorId, creatorName: creatorName, characteristics: characteristics, health: 100, potColor: '#A1887F', waterLevel: 80, energyLevel: 80, fertilizerLevel: 10, pestLevel: 0, isLightOn: false, growthStage: 'GRAINE', potSize: 'Petit', isMusicPlaying: false, musicEndTime: 0, environmentStatus: 'Optimal', timeBorn: now, lastUpdateTime: now, lastWateredBy: "?", lastLightToggleBy: "?", lastFertilizedBy: "?", lastPesticideBy: "?", lastRepottedBy: "?", lastMusicBy: "?", lastCleanedBy: "?", lastPrunedBy: "?", lastTalkTime: 0, lastFertilizeTime: 0, lastPesticideTime: 0, lastRepotTime: 0, lastPlayMusicTime: 0, lastCleanTime: 0, lastPruneTime: 0, lastCheckEnvTime: 0, lastObserveTime: 0, lastHarvestTime: 0, lastMistTime: 0 }; gameState.plants[plantId] = newPlant; console.log(`Plante créée: ${plantId} par ${creatorName} nommée ${safeName}`); addLogEntry(creatorName, `a créé: ${newPlant.name}`); broadcastPlantsUpdate(); return plantId; }

// --- Game Loop Logic ---
function gameLoop() {
    const now = getCurrentTimestamp(); let needsBroadcast = false;
    for (const plantId in gameState.plants) {
        const ps = gameState.plants[plantId]; if (!ps) continue;
        const lastUpdate = ps.lastUpdateTime || now; const timeDiffMs = now - lastUpdate; const timeDiffHours = timeDiffMs / 36e5;
        if (timeDiffMs <= 0) continue;
        let plantChanged = false; const char = ps.characteristics || {};
        const waterTol = char.waterTolerance==='Haute'?0.7:(char.waterTolerance==='Basse'?1.3:1); const lightTol = char.lightTolerance==='Haute'?0.7:(char.lightTolerance==='Basse'?1.3:1);
        const lifeFactor = char.lifespanFactor || 1; const pestRes = char.pestResistanceFactor || 1; const envRes = char.envResistanceFactor || 1;
        const isMature = ps.growthStage === 'MATURE' || ps.growthStage === 'FLORAISON';
        const isNeglected = ps.waterLevel < 20 || ps.energyLevel < 20 || ps.health < 50; // Define neglect

        // --- Health Calculation ---
        let healthChange = 0; const isWilted = ps.health <= 0;
        if (!isWilted) {
            if (ps.waterLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTol; if (ps.waterLevel > 98) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTol * 0.5;
            if (ps.energyLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * lightTol;
            if (ps.pestLevel > 60) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 1.5 / pestRes; else if (ps.pestLevel > 30) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.8 / pestRes;
            if (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.5 / envRes;
            // Aging penalty if mature and neglected
            if (isMature && isNeglected) { healthChange -= AGING_HEALTH_LOSS_RATE * timeDiffHours / lifeFactor; }
            // Regeneration
            if (ps.waterLevel > 50 && ps.energyLevel > 50 && ps.pestLevel < 20 && ps.fertilizerLevel > 5) { healthChange += HEALTH_REGEN_RATE * timeDiffHours * lifeFactor; }
            const newHealth = Math.max(0, Math.min(100, ps.health + healthChange)); if (newHealth !== ps.health) plantChanged = true; ps.health = newHealth;
            if (ps.health <= 0 && !isWilted) { addLogEntry("Système", `"${ps.name}" a flétri...`); if (ps.isMusicPlaying) ps.isMusicPlaying = false; plantChanged = true; }
        }

        // --- Resource Depletion/Gain (Only if not wilted) ---
        if (!isWilted) {
            const waterNeed = (WATER_DEPLETION_RATE_PER_HOUR * (char.waterNeedFactor || 1)) / lifeFactor; const newWater = Math.max(0, ps.waterLevel - (waterNeed * timeDiffHours)); if (newWater !== ps.waterLevel) plantChanged = true; ps.waterLevel = newWater;
            const lightNeed = (char.lightNeedFactor || 1); const pestFactor = (1 - ps.pestLevel / 150); const envFactor = (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') ? 0.7 : 1;
            if (ps.isLightOn) { const energyGain = timeDiffHours * ENERGY_GAIN_RATE_PER_HOUR * lightNeed * pestFactor * envFactor; const newEnergy = Math.min(100, ps.energyLevel + energyGain); if (newEnergy !== ps.energyLevel) plantChanged = true; ps.energyLevel = newEnergy; if (char.lightTolerance === 'Basse' && ps.energyLevel > 95) { const oldWater = ps.waterLevel; ps.waterLevel = Math.max(0, ps.waterLevel - (timeDiffHours * 2)); if(ps.waterLevel !== oldWater) plantChanged = true; } } else { const energyDepletion = timeDiffHours * ENERGY_DEPLETION_RATE_PER_HOUR * lightNeed * envFactor * lightTol; const newEnergy = Math.max(0, ps.energyLevel - energyDepletion); if (newEnergy !== ps.energyLevel) plantChanged = true; ps.energyLevel = newEnergy; }
            const fertNeed = (char.fertilizerNeedFactor || 1); const fertDepl = timeDiffHours * FERTILIZER_DEPLETION_RATE_PER_HOUR * fertNeed; const newFert = Math.max(0, ps.fertilizerLevel - fertDepl); if (newFert !== ps.fertilizerLevel) plantChanged = true; ps.fertilizerLevel = newFert;
            let pestChange=0; const pestResistEvent = getEventMultiplier('pest_resist'); if(ps.waterLevel<40||ps.energyLevel<40)pestChange=timeDiffHours*PEST_INCREASE_RATE_PER_HOUR*1.5/pestRes;else if(ps.waterLevel>80&&ps.energyLevel>80)pestChange=-(timeDiffHours*PEST_DECREASE_RATE_PER_HOUR*pestRes*pestResistEvent);else pestChange=timeDiffHours*PEST_INCREASE_RATE_PER_HOUR*0.5/pestRes; if(ps.environmentStatus==='Infesté de nuisibles')pestChange*=2;if(ps.environmentStatus==='Optimal')pestChange*=0.5; const newPest=Math.max(0,Math.min(100,ps.pestLevel+pestChange)); if(newPest!==ps.pestLevel)plantChanged=true;ps.pestLevel=newPest;
            if (ps.isMusicPlaying && now > ps.musicEndTime) { ps.isMusicPlaying = false; plantChanged = true; }
            if (Math.random() < ENVIRONMENT_CHANGE_CHANCE / Math.max(1, Object.keys(gameState.plants).length)) { const oldEnv = ps.environmentStatus; ps.environmentStatus = getRandomEnvStatus(ps.pestLevel); if (ps.environmentStatus !== oldEnv) plantChanged = true; }
        }
        ps.lastUpdateTime = now;
        // Growth Check
        const timeAliveMs = now - ps.timeBorn; const currentStage = ps.growthStage; const stageData = GROWTH_STAGES[currentStage];
        if (ps.health > 50 && !isWilted && stageData && stageData.nextStage) { // Health > 50 needed
            const nextStageData = GROWTH_STAGES[stageData.nextStage]; const growthRate = (char.growthRateFactor || 1) * getEventMultiplier('growth'); const healthFactor = 1; const potFactor = (ps.potSize === 'Petit' && currentStage === 'JEUNE') ? 0.5 : (ps.potSize !== 'Large' && currentStage === 'MATURE') ? 0.5 : 1; const effectiveTimeAliveMs = timeAliveMs * growthRate * (1 + (ps.fertilizerLevel / 120)) * potFactor;
            if (healthFactor > 0 && effectiveTimeAliveMs >= nextStageData.timeThreshold) { ps.growthStage = stageData.nextStage; addLogEntry("Système", `"${ps.name}" => ${nextStageData.name}!`); if (ps.creatorId && ps.creatorId !== "Système") { addScore(ps.creatorId, SCORE_PER_GROWTH); if (ps.growthStage === 'FLORAISON') addScore(ps.creatorId, SCORE_PER_FLOWER); } plantChanged = true; }
        }
        if (plantChanged) needsBroadcast = true;
    } // End plant loop
    if (needsBroadcast) broadcastPlantsUpdate();
    if (now - lastSaveTime >= SAVE_INTERVAL) saveGameState();
}


// --- Server Setup & Socket Handling ---
app.use(express.static(__dirname));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

io.on('connection', (socket) => {
    const socketId = socket.id; const userId = uuidv4();
    gameState.users[socketId] = { userId: userId, username: `Jardinier_${userId.substring(0, 4)}`, lastCreateTime: 0, lastWaterAllTime: 0, currentQuest: null, questProgressData: {} };
    console.log(`Connecté: ${socketId} -> ${userId}`);
    if (!gameState.scores[userId]) gameState.scores[userId] = { username: gameState.users[socketId].username, score: 0, coins: 0 };
    else { gameState.scores[userId].username = gameState.users[socketId].username; gameState.scores[userId].coins = gameState.scores[userId].coins || 0; }

    assignNewQuest(socketId);

    socket.emit('plantsUpdate', gameState.plants); socket.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES));
    socket.emit('leaderboardUpdate', getTopScores()); socket.emit('userId', userId);
    socket.emit('usernameUpdate', gameState.users[socketId].username);
    socket.emit('questUpdate', gameState.users[socketId].currentQuest);
    socket.emit('eventUpdate', gameState.currentEvent); // Send current event on connect
    socket.emit('shopItemsUpdate', SHOP_ITEMS); // Send shop items on connect
    broadcastPlayerInfo(socketId);

    socket.on('setUsername', (newName) => { const cleanName=String(newName||'').trim().substring(0,20);if(cleanName&&gameState.users[socketId]){const oldName=gameState.users[socketId].username;const currentUserId=gameState.users[socketId].userId;gameState.users[socketId].username=cleanName;updateScoreUsername(currentUserId,cleanName);console.log(`User ${socketId}(${oldName}) -> ${cleanName}`);addLogEntry("Système",`${oldName} -> ${cleanName}`);broadcastLeaderboard();}});

    // --- Generic Action Handler v7 ---
    const actions = {
        waterPlant: { cooldown: 0, score: SCORE_PER_ACTION * getEventMultiplier('care_score'), effect: (ps, user) => { ps.waterLevel = Math.min(100, ps.waterLevel + WATER_PER_CLICK); ps.health = Math.min(100, ps.health + 1); ps.lastWateredBy = user; }, logMsg: "a arrosé" },
        toggleLight: { cooldown: 0, score: 0, effect: (ps, user) => { ps.isLightOn = !ps.isLightOn; ps.lastLightToggleBy = user; }, logMsgDynamic: (ps) => `a mis la lumière ${ps.isLightOn ? 'ON' : 'OFF'}` },
        cleanLeaves: { cooldown: CLEAN_LEAVES_COOLDOWN, score: SCORE_PER_ACTION * getEventMultiplier('care_score'), lastActionTimeKey: 'lastCleanTime', effect: (ps, user) => { ps.energyLevel = Math.min(100, ps.energyLevel + CLEAN_LEAVES_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 1); ps.lastCleanedBy = user; }, logMsg: "a nettoyé les feuilles" },
        gentleMist: { cooldown: MIST_COOLDOWN, score: SCORE_PER_MIST * getEventMultiplier('care_score'), lastActionTimeKey: 'lastMistTime', effect: (ps, user) => { ps.waterLevel = Math.min(100, ps.waterLevel + MIST_WATER_BOOST); ps.energyLevel = Math.min(100, ps.energyLevel + MIST_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.5); }, logMsg: "a brumisé"},
        fertilizePlant: { cooldown: FERTILIZE_COOLDOWN, score: SCORE_PER_ACTION, lastActionTimeKey: 'lastFertilizeTime', effect: (ps, user) => { ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + (FERTILIZER_PER_CLICK * getEventMultiplier('fertilizer'))); ps.health = Math.min(100, ps.health + 2); ps.lastFertilizedBy = user; }, logMsg: "a fertilisé" }, // Event multiplier
        applyPesticide: { cooldown: PESTICIDE_COOLDOWN, score: SCORE_PER_ACTION, lastActionTimeKey: 'lastPesticideTime', condition: (ps) => ps.pestLevel > 5, effect: (ps, user) => { ps.pestLevel = Math.max(0, ps.pestLevel - PESTICIDE_EFFECT); ps.lastPesticideBy = user; }, logMsg: "a appliqué du pesticide" },
        prunePlant: { cooldown: PRUNE_COOLDOWN, score: SCORE_PER_ACTION, lastActionTimeKey: 'lastPruneTime', condition: (ps) => GROWTH_STAGES[ps.growthStage]?.canPrune, effect: (ps, user) => { ps.energyLevel = Math.min(100, ps.energyLevel + PRUNE_HEALTH_BOOST); ps.waterLevel = Math.min(100, ps.waterLevel + 5); ps.health = Math.min(100, ps.health + PRUNE_HEALTH_BOOST); ps.lastPrunedBy = user; }, logMsg: "a taillé" },
        repotPlant: { cooldown: REPOT_COOLDOWN, score: SCORE_PER_ACTION * 2, lastActionTimeKey: 'lastRepotTime', condition: (ps) => GROWTH_STAGES[ps.growthStage]?.canRepot && ps.potSize !== 'Large', effect: (ps, user) => { const oldSize = ps.potSize; if (oldSize === 'Petit') ps.potSize = 'Moyen'; else if (oldSize === 'Moyen') ps.potSize = 'Large'; ps.fertilizerLevel = Math.max(0, ps.fertilizerLevel - 20); ps.health = Math.min(100, ps.health + 10); ps.lastRepottedBy = user; }, logMsgDynamic: (ps) => `a rempoté dans un pot ${ps.potSize}` },
        harvestSeed: { cooldown: HARVEST_COOLDOWN, score: SCORE_PER_SEED, coins: COINS_PER_HARVEST * getEventMultiplier('harvest_coins'), lastActionTimeKey: 'lastHarvestTime', condition: (ps) => ps.growthStage === 'FLORAISON', effect: (ps, user) => {}, logMsg: "a récolté une graine"}, // Event multiplier
        talkToPlant: { cooldown: TALK_COOLDOWN, score: SCORE_PER_ACTION * getEventMultiplier('care_score'), lastActionTimeKey: 'lastTalkTime', effect: (ps, user) => { ps.energyLevel = Math.min(100, ps.energyLevel + TALK_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.2); }, logMsg: "a parlé gentiment" },
        playMusic: { cooldown: PLAY_MUSIC_COOLDOWN, score: SCORE_PER_ACTION, lastActionTimeKey: 'lastPlayMusicTime', condition: (ps) => !ps.isMusicPlaying, effect: (ps, user) => { ps.isMusicPlaying = true; ps.musicEndTime = getCurrentTimestamp() + MUSIC_DURATION; ps.lastMusicBy = user; }, logMsg: "a joué de la musique" },
        observePlant: { cooldown: OBSERVE_COOLDOWN, score: SCORE_PER_OBSERVE, lastActionTimeKey: 'lastObserveTime', effect: (ps, user, socket) => { const char=ps.characteristics||{}; let obs=[]; if(char.waterTolerance==='Basse')obs.push("Sensible eau.");if(char.waterTolerance==='Haute')obs.push("Tolère eau.");if((char.waterNeedFactor||1)<0.9)obs.push("Moins soif.");if((char.waterNeedFactor||1)>1.1)obs.push("Plus soif."); if(char.lightTolerance==='Basse')obs.push("Sensible lumière.");if(char.lightTolerance==='Haute')obs.push("Tolère lumière.");if((char.lightNeedFactor||1)<0.9)obs.push("Moins lumière.");if((char.lightNeedFactor||1)>1.1)obs.push("Plus lumière."); if((char.pestResistanceFactor||1)<0.9)obs.push("Résiste nuisibles.");if((char.envResistanceFactor||1)<0.9)obs.push("Résiste env."); obs.push(`Feuilles: ${char.leafShape||'?'}.`);if(ps.growthStage==='FLORAISON')obs.push(`Fleurs: ${char.flowerColor||'?'}.`); if(char.rareTrait){const ti=RARE_TRAITS.find(t=>t.n===char.rareTrait);obs.push(`Trait: ${char.rareTrait}! ${ti?.d||''}`);} const fb=obs.length>0?obs.join(' '):"Semble être une plante tout à fait normale."; socket.emit('plantObservation',{plantId:ps.plantId,text:fb});}, logMsg: "a observé"},
        checkEnvironment: { cooldown: ENV_CHECK_COOLDOWN, score: 0, lastActionTimeKey: 'lastCheckEnvTime', effect: (ps, user) => {}, logMsgDynamic: (ps) => `a vérifié l'env. (${ps.environmentStatus})` }
    };

    for (const actionName in actions) {
        socket.on(actionName, (data) => {
            const user = gameState.users[socketId]; if (!user) return; const userId = user.userId; const username = user.username;
            const plantId = data?.plantId; const ps = gameState.plants[plantId]; if (!ps) { console.warn(`Action ${actionName} on unknown plant ${plantId}`); return; }
            const actionConfig = actions[actionName]; const now = getCurrentTimestamp();
            if (actionConfig.cooldown > 0 && actionConfig.lastActionTimeKey) { if ((now - (ps[actionConfig.lastActionTimeKey] || 0)) < actionConfig.cooldown) { addLogEntry(username, `a essayé ${actionName} (cd)`, ps.name); return; } }
             if (ps.health <= 0) { addLogEntry(username, `a essayé ${actionName} (flétrie)`, ps.name); return; } // Check health before action
             if (actionConfig.condition && !actionConfig.condition(ps)) { addLogEntry(username, `a essayé ${actionName} (cond. échec)`, ps.name); return; }
            actionConfig.effect(ps, username, socket); ps.lastUpdateTime = now; if (actionConfig.lastActionTimeKey) ps[actionConfig.lastActionTimeKey] = now;
            if (actionConfig.score || actionConfig.coins) addScore(userId, actionConfig.score || 0, actionConfig.coins || 0);
            checkQuestProgress(socketId, actionName, plantId);
            const logMessage = actionConfig.logMsgDynamic ? actionConfig.logMsgDynamic(ps) : actionConfig.logMsg; addLogEntry(username, logMessage, ps.name);
            broadcastPlantsUpdate(); broadcastPlayerInfo(socketId);
        });
    }

     socket.on('createPlant', (data) => { const user=gameState.users[socketId];if(!user)return;const now=getCurrentTimestamp(); if(now-user.lastCreateTime<CREATE_PLANT_COOLDOWN){addLogEntry(user.username,"a essayé créer (cd)");socket.emit('actionFeedback',{success:!1,message:"Cooldown création."});return;} if(Object.keys(gameState.plants).length>=MAX_PLANTS){addLogEntry(user.username,"a essayé créer (max)");socket.emit('actionFeedback',{success:!1,message:"Max plantes atteint."});return;} const plantNameRequest = data?.plantName; const newPlantId=createPlant(user.userId,user.username, plantNameRequest); if(newPlantId){user.lastCreateTime=now;socket.emit('actionFeedback',{success:!0,message:`Plante créée!`, sound: 'create'});}else{socket.emit('actionFeedback',{success:!1,message:"Erreur création."});} });
     socket.on('waterAllPlants', () => {
         const user = gameState.users[socketId]; if (!user) return; const now = getCurrentTimestamp();
         if (now - user.lastWaterAllTime < WATER_ALL_COOLDOWN) { addLogEntry(user.username, "a essayé 'Tout Arroser' (cd)"); socket.emit('actionFeedback', { success: false, message: "Cooldown 'Tout Arroser'." }); return; }
         let wateredCount = 0; let totalScore = 0;
         for (const plantId in gameState.plants) { const ps = gameState.plants[plantId]; if (ps && ps.health > 0 && ps.waterLevel < 95) { ps.waterLevel = Math.min(100, ps.waterLevel + WATER_ALL_BOOST); ps.lastUpdateTime = now; ps.lastWateredBy = user.username; wateredCount++; totalScore += SCORE_PER_ACTION; plantChanged = true; } }
         if (wateredCount > 0) { user.lastWaterAllTime = now; addScore(user.userId, totalScore, 0); addLogEntry(user.username, `a arrosé ${wateredCount} plante(s)`); broadcastPlantsUpdate(); broadcastPlayerInfo(socketId); socket.emit('actionFeedback', { success: true, message: `${wateredCount} plante(s) arrosée(s)!`, sound: 'water' }); } else { addLogEntry(user.username, "a essayé 'Tout Arroser' (aucune à arroser)"); socket.emit('actionFeedback', { success: false, message: "Aucune plante n'avait besoin." }); }
     });
     socket.on('buyItem', (data) => {
         const user = gameState.users[socketId]; if (!user) return; const userId = user.userId; const username = user.username;
         const itemId = data?.itemId; const targetPlantId = data?.plantId; const item = SHOP_ITEMS[itemId]; const playerScore = gameState.scores[userId];
         if (!item) { socket.emit('actionFeedback', { success: false, message: "Objet inconnu." }); return; }
         if (!playerScore || (playerScore.coins || 0) < item.price) { socket.emit('actionFeedback', { success: false, message: "Pièces insuffisantes." }); return; }
         addScore(userId, 0, -item.price); // Deduct cost first
         if (item.type === 'seed') { const newPlantId = createPlant(userId, username, `Graine ${item.name}`); if (newPlantId) { addLogEntry(username, `a acheté: ${item.name}`); socket.emit('actionFeedback', { success: true, message: `${item.name} acheté!`, sound: 'buy' }); } else { addScore(userId, 0, item.price); socket.emit('actionFeedback', { success: false, message: "Achat échoué (max plantes?)." }); } }
         else if (item.type === 'cosmetic') { if (itemId.startsWith('pot_') && targetPlantId && gameState.plants[targetPlantId]) { gameState.plants[targetPlantId].potColor = item.value; addLogEntry(username, `a acheté ${item.name} pour ${gameState.plants[targetPlantId].name}`); socket.emit('actionFeedback', { success: true, message: `${item.name} appliqué !`, sound: 'buy' }); broadcastPlantsUpdate(); } else { addScore(userId, 0, item.price); socket.emit('actionFeedback', { success: false, message: "Plante cible invalide." }); } }
         else if (item.type === 'consumable' || item.type === 'boost') { // Handle new item types
             const ps = gameState.plants[targetPlantId];
             if (!ps) { addScore(userId, 0, item.price); socket.emit('actionFeedback', { success: false, message: "Plante cible invalide." }); return; }
             if (ps.health <= 0) { addScore(userId, 0, item.price); socket.emit('actionFeedback', { success: false, message: "Plante flétrie." }); return; }

             if (item.effect === 'pesticide') {
                 ps.pestLevel = Math.max(0, ps.pestLevel - item.amount);
                 addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`);
                 socket.emit('actionFeedback', { success: true, message: `${item.name} utilisé !`, sound: 'buy' });
                 broadcastPlantsUpdate();
             } else if (item.effect === 'fertilizer') {
                 // For boosts, we might need to add temporary effects logic later
                 // For now, just add a chunk of fertilizer level
                 ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + item.amount);
                 addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`);
                 socket.emit('actionFeedback', { success: true, message: `${item.name} utilisé !`, sound: 'buy' });
                 broadcastPlantsUpdate();
             } else {
                  addScore(userId, 0, item.price); // Refund if effect unknown
                  socket.emit('actionFeedback', { success: false, message: "Effet d'objet inconnu." });
             }
         }
         broadcastPlayerInfo(socketId); saveGameState();
     });

     socket.on('disconnect', () => { console.log(`Déconnecté: ${socketId}`);const user=gameState.users[socketId];if(user){addLogEntry("Système",`${user.username} déconnecté.`);delete gameState.users[socketId];}});
});

// --- Leaderboard Utility ---
function getTopScores(count = 10) { return Object.entries(gameState.scores).map(([uid,d])=>({userId:uid,username:d.username,score:d.score,coins:d.coins||0})).sort((a,b)=>b.score-a.score).slice(0,count); }

// --- Start Server ---
server.listen(PORT, () => { console.log(`Serveur v7 fonctionnel écoutant sur *:${PORT}`); loadGameState(); if(gameLoopTimer)clearInterval(gameLoopTimer);gameLoopTimer=setInterval(gameLoop,GAME_LOOP_INTERVAL);if(leaderboardUpdateTimer)clearInterval(leaderboardUpdateTimer);leaderboardUpdateTimer=setInterval(broadcastLeaderboard,LEADERBOARD_UPDATE_INTERVAL); if(eventTimer)clearInterval(eventTimer); eventTimer = setInterval(checkEvent, EVENT_CHECK_INTERVAL); console.log("Boucles démarrées (Jeu, Classement, Événements)."); });
process.on('SIGINT', () => { console.log('\nArrêt...'); saveGameState(); if(gameLoopTimer)clearInterval(gameLoopTimer);if(leaderboardUpdateTimer)clearInterval(leaderboardUpdateTimer); if(eventTimer)clearInterval(eventTimer); process.exit(); });
