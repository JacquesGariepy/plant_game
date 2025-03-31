// server.js (v7.3 - Visual Growth/Degradation Logic)
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

// --- Game Constants ---
const MAX_LOG_ENTRIES = 30;
const MAX_PLANTS = 50;
// Action effects & Costs
const WATER_PER_CLICK = 30;
const FERTILIZER_PER_CLICK = 40;
const PESTICIDE_EFFECT = 50;
const PESTICIDE_STRONG_EFFECT = 80; // New item effect
const MUSIC_DURATION = 2 * 60 * 1000; // 2 minutes
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
const ENVIRONMENT_CHANGE_CHANCE = 0.05; // Base chance per plant per loop, adjusted in loop
// Cooldowns (ms)
const TALK_COOLDOWN = 60 * 1000; // 1 min
const FERTILIZE_COOLDOWN = 5 * 60 * 1000; // 5 min
const PESTICIDE_COOLDOWN = 10 * 60 * 1000; // 10 min
const REPOT_COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours
const PLAY_MUSIC_COOLDOWN = 15 * 60 * 1000; // 15 min
const CLEAN_LEAVES_COOLDOWN = 2 * 60 * 1000; // 2 min
const PRUNE_COOLDOWN = 6 * 60 * 60 * 1000; // 6 hours
const ENV_CHECK_COOLDOWN = 30 * 1000; // 30 sec
const CREATE_PLANT_COOLDOWN = 1 * 60 * 1000; // 1 min
const OBSERVE_COOLDOWN = 1 * 60 * 1000; // 1 min
const HARVEST_COOLDOWN = 4 * 60 * 60 * 1000; // 4 hours
const MIST_COOLDOWN = 30 * 1000; // 30 sec
const WATER_ALL_COOLDOWN = 5 * 60 * 1000; // 5 min
// Scoring & Currency
const SCORE_PER_ACTION = 1;
const SCORE_PER_GROWTH = 10;
const SCORE_PER_FLOWER = 50;
const SCORE_PER_SEED = 25;
const SCORE_PER_OBSERVE = 2;
const SCORE_PER_MIST = 1;
const COINS_PER_QUEST = 50;
const COINS_PER_HARVEST = 10;

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
// GROWTH_STAGES: n=Name, i=Icon, nt=NextStageKey, t=TimeThreshold (ms from birth), r=CanRepot?, p=CanPrune?
const GROWTH_STAGES = {
    GRAINE:    { n: "Graine",       i: "fa-seedling", nt: 'POUSSE',    t: 0,                r: false, p: false },
    POUSSE:    { n: "Pousse",       i: "fa-seedling", nt: 'JEUNE',     t: 1 * 36e5,         r: false, p: false }, // 1 hour
    JEUNE:     { n: "Jeune Plante", i: "fa-leaf",     nt: 'MATURE',    t: 6 * 36e5,         r: true,  p: false }, // 6 hours
    MATURE:    { n: "Plante Mature",i: "fa-spa",      nt: 'FLORAISON', t: 24 * 36e5,        r: true,  p: true },  // 24 hours
    FLORAISON: { n: "En Fleur",     i: "fa-fan",      nt: null,        t: Infinity,         r: true,  p: true }   // Final stage
};
const POT_SIZES = ['Petit', 'Moyen', 'Large'];
const ENVIRONMENT_STATUSES = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide', 'Infesté de nuisibles'];
const PLANT_COLORS = ['#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7']; // Greens
const LEAF_SHAPES = ['Ovale', 'Pointue', 'Dentelée', 'Lobée', 'Cordée'];
const FLOWER_COLORS = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#ffffff', '#ffeb3b', '#ff9800']; // Pinks, Purples, Blues, White, Yellow, Orange
const TOLERANCE_LEVELS = ['Basse', 'Moyenne', 'Haute'];
const RARE_TRAITS = [ { n:'Feuilles Scintillantes',d:'Ses feuilles brillent légèrement.'}, { n:'Lueur Nocturne',d:'Émet une douce lueur dans le noir.'}, { n:'Parfum Envoûtant',d:'Dégage un parfum agréable et unique.'}, { n:'Mélodie Murmurante',d:'Semble fredonner une douce mélodie.'}, { n:'Nectar Précieux',d:'Produit un nectar rare et sucré.'} ];
const RARE_TRAIT_CHANCE = 0.03; // 3% chance

// --- Quest Definitions ---
const QUESTS = [
    { id: 'water3', description: "Arroser 3 plantes différentes", target: 3, action: 'waterPlant', uniqueTarget: true, reward: { score: 10, coins: COINS_PER_QUEST } },
    { id: 'clean5', description: "Nettoyer les feuilles de 5 plantes", target: 5, action: 'cleanLeaves', reward: { score: 15, coins: COINS_PER_QUEST } },
    { id: 'observe2', description: "Observer 2 plantes", target: 2, action: 'observePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } },
    { id: 'fertilize1', description: "Fertiliser 1 plante", target: 1, action: 'fertilizePlant', reward: { score: 5, coins: COINS_PER_QUEST / 2 } },
    { id: 'mist4', description: "Brumiser 4 fois", target: 4, action: 'gentleMist', reward: { score: 8, coins: COINS_PER_QUEST / 2 } },
    // Add more varied quests later
];

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
    plants: {},        // { plantId: { plantData } }
    scores: {},        // { userId: { username, score, coins } }
    users: {},         // { socketId: { userId, username, lastActionTimes, currentQuest, questProgressData } }
    logs: [],          // [{ user, action, timestamp }]
    currentEvent: null // { id, name, endTime, description, effectMultiplier }
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
function getUsername(userId) {
    if (!userId) return 'Inconnu';
    if (gameState.scores[userId]) return gameState.scores[userId].username;
    // Fallback: find username from users object if score entry doesn't exist yet
    for (const sId in gameState.users) {
        if (gameState.users[sId].userId === userId) return gameState.users[sId].username;
    }
    return 'Anonyme';
}
function getRandomEnvStatus(currentPestLevel) {
    // Higher pest level increases chance of 'Infested' status
    const pestChance = Math.min(0.5, currentPestLevel / 150); // Max 50% chance based on pests
    if (Math.random() < pestChance) return 'Infesté de nuisibles';
    const statuses = ['Optimal', 'Un peu froid', 'Un peu chaud', 'Un peu sec', 'Un peu humide'];
    return randomChoice(statuses);
}
function generatePlantCharacteristics() {
    let rareTrait = null;
    if (Math.random() < RARE_TRAIT_CHANCE) {
        rareTrait = randomChoice(RARE_TRAITS);
    }
    return {
        waterNeedFactor: randomInRange(0.8, 1.2),
        lightNeedFactor: randomInRange(0.8, 1.2),
        fertilizerNeedFactor: randomInRange(0.7, 1.3),
        baseColor: randomChoice(PLANT_COLORS),
        leafShape: randomChoice(LEAF_SHAPES),
        flowerColor: randomChoice(FLOWER_COLORS),
        growthRateFactor: randomInRange(0.9, 1.1),
        pestResistanceFactor: randomInRange(0.8, 1.2),
        envResistanceFactor: randomInRange(0.8, 1.2),
        lifespanFactor: randomInRange(0.9, 1.1), // Affects health loss rate from aging/neglect
        waterTolerance: randomChoice(TOLERANCE_LEVELS), // Low = needs careful watering, High = resistant to over/under water
        lightTolerance: randomChoice(TOLERANCE_LEVELS), // Low = sensitive to too much/little light, High = resistant
        rareTrait: rareTrait ? rareTrait.n : null, // Store only the name
    };
}

// --- Game State Management ---
function initializeGameState() {
    console.log("Initializing new game state v7.3...");
    const now = getCurrentTimestamp();
    gameState.plants = {};
    gameState.scores = {};
    gameState.users = {};
    gameState.logs = [];
    gameState.currentEvent = null;
    // Create a default starting plant if none exist
    createPlant("Système", "Gaïa Prima", "Système");
    saveGameState();
}

function loadGameState() {
    try {
        if (fs.existsSync(GAMESTATE_FILE)) {
            const data = fs.readFileSync(GAMESTATE_FILE, 'utf8');
            const loadedData = JSON.parse(data);

            // Basic structure validation
            gameState.plants = loadedData.plants && typeof loadedData.plants === 'object' ? loadedData.plants : {};
            gameState.scores = loadedData.scores && typeof loadedData.scores === 'object' ? loadedData.scores : {};
            gameState.logs = Array.isArray(loadedData.logs) ? loadedData.logs.slice(0, MAX_LOG_ENTRIES * 5) : []; // Limit log size on load
            gameState.currentEvent = loadedData.currentEvent || null; // Load event
            gameState.users = {}; // Reset users, they reconnect

            // Ensure scores have coins
            for (const userId in gameState.scores) {
                gameState.scores[userId].coins = gameState.scores[userId].coins || 0;
            }

            // Validate and apply defaults to each loaded plant
            let plantCount = 0;
            for (const plantId in gameState.plants) {
                plantCount++;
                const plant = gameState.plants[plantId];

                // Define default values for potentially missing fields
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
                    growthProgress: 0 // << ADD Default value for growthProgress
                };

                // Apply defaults if property is missing or null
                for (const key in defaults) {
                    if (plant[key] === undefined || plant[key] === null) {
                        plant[key] = defaults[key];
                    }
                }

                 // Validate/Generate characteristics
                 if (!plant.characteristics || typeof plant.characteristics !== 'object') {
                      plant.characteristics = generatePlantCharacteristics();
                 } else {
                      // Ensure essential characteristic properties exist
                      const charDefaults = { waterNeedFactor: 1, lightNeedFactor: 1, fertilizerNeedFactor: 1, baseColor: PLANT_COLORS[0], leafShape: LEAF_SHAPES[0], flowerColor: FLOWER_COLORS[0], growthRateFactor: 1, pestResistanceFactor: 1, envResistanceFactor: 1, lifespanFactor: 1, waterTolerance: 'Moyenne', lightTolerance: 'Moyenne', rareTrait: null };
                      for (const charKey in charDefaults) {
                           if (plant.characteristics[charKey] === undefined || plant.characteristics[charKey] === null) {
                                plant.characteristics[charKey] = charDefaults[charKey];
                           }
                      }
                 }
                 // Validate growth stage
                 if (!GROWTH_STAGES[plant.growthStage]) {
                      console.warn(`Invalid growth stage "${plant.growthStage}" for plant ${plantId}. Resetting to GRAINE.`);
                      plant.growthStage = 'GRAINE';
                      plant.growthProgress = 0; // Reset progress too
                 }

                 // Ensure growthProgress is defined
                 if (plant.growthProgress === undefined) {
                      plant.growthProgress = 0;
                 }
            }

            if (plantCount === 0) {
                console.log("No plants found in saved state. Creating initial plant.");
                createPlant("Système", "Gaïa Prima", "Système");
            }

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
    // Throttle saving: Don't save if last save was less than 5 seconds ago (unless it's the first save)
    if (now - lastSaveTime < 5000 && lastSaveTime !== 0) {
        // console.log("Save skipped (throttled)");
        return;
    }
    lastSaveTime = now;
    console.log(`Saving game state at ${new Date(now).toLocaleTimeString()}...`);
    try {
        // Prune logs before saving if excessively long (double check)
        if (gameState.logs.length > MAX_LOG_ENTRIES * 10) {
             console.warn(`Pruning logs from ${gameState.logs.length} before saving.`);
             gameState.logs = gameState.logs.slice(0, MAX_LOG_ENTRIES * 5);
        }
        const dataToSave = {
            plants: gameState.plants,
            scores: gameState.scores,
            logs: gameState.logs, // Save the current log buffer
            currentEvent: gameState.currentEvent
        };
        // Use async writing for potentially better performance, though sync is safer on shutdown
        fs.writeFile(GAMESTATE_FILE, JSON.stringify(dataToSave), 'utf8', (err) => {
            if (err) {
                 console.error("Error writing game state asynchronously:", err);
            } else {
                 // console.log("Game state saved successfully.");
            }
        });
        // fs.writeFileSync(GAMESTATE_FILE, JSON.stringify(dataToSave), 'utf8'); // Sync alternative
    } catch (error) {
        console.error("Error saving game state:", error);
    }
}

function addLogEntry(user, action, plantName = null) {
    const logAction = plantName ? `${action} (${plantName})` : action;
    const newLog = {
        user: user || 'Système',
        action: logAction,
        timestamp: getCurrentTimestamp()
    };
    gameState.logs.unshift(newLog); // Add to the beginning

    // Trim logs if they exceed the maximum length
    if (gameState.logs.length > MAX_LOG_ENTRIES * 5) { // Keep a larger buffer in memory than displayed
        gameState.logs = gameState.logs.slice(0, MAX_LOG_ENTRIES * 5);
    }

    broadcastLogs(); // Send update to clients
    // Don't save state on every log entry, rely on interval saving
    // saveGameState();
}

function addScore(userId, scorePoints = 0, coinAmount = 0) {
    if (!userId || (scorePoints <= 0 && coinAmount <= 0)) return;

    // Initialize score entry if it doesn't exist
    if (!gameState.scores[userId]) {
        let username = getUsername(userId); // Try to find username
        gameState.scores[userId] = { username: username, score: 0, coins: 0 };
    }

    gameState.scores[userId].score += scorePoints;
    gameState.scores[userId].coins = (gameState.scores[userId].coins || 0) + coinAmount;

    console.log(`Score/Coins Update - User: ${userId} (${gameState.scores[userId].username}), Score: ${gameState.scores[userId].score} (+${scorePoints}), Coins: ${gameState.scores[userId].coins} (+${coinAmount})`);
    // Leaderboard will be broadcast periodically
}

function updateScoreUsername(userId, newUsername) {
    if (gameState.scores[userId]) {
        gameState.scores[userId].username = newUsername;
    } else {
        // If score entry didn't exist yet, create it
        gameState.scores[userId] = { username: newUsername, score: 0, coins: 0 };
    }
}


// --- Quest Management ---
function assignNewQuest(socketId) {
    const user = gameState.users[socketId];
    if (!user) return;

    const completedQuestId = user.currentQuest?.id; // Get previous quest ID if any

    // Filter out the *just* completed quest to avoid immediate repetition
    const availableQuests = QUESTS.filter(q => q.id !== completedQuestId);
    const questPool = availableQuests.length > 0 ? availableQuests : QUESTS; // Use full list if filter resulted in empty

    const newQuestTemplate = randomChoice(questPool);

    user.currentQuest = {
        id: newQuestTemplate.id,
        description: newQuestTemplate.description,
        progress: 0,
        target: newQuestTemplate.target,
        action: newQuestTemplate.action,
        reward: newQuestTemplate.reward,
        completed: false,
        uniqueTarget: newQuestTemplate.uniqueTarget || false
    };
    user.questProgressData = {}; // Reset progress tracking data for unique targets

    console.log(`New quest assigned '${user.currentQuest.id}' to ${user.username} (${user.userId})`);
    io.to(socketId).emit('questUpdate', user.currentQuest);
}

function checkQuestProgress(socketId, actionName, plantId = null) {
    const user = gameState.users[socketId];
    if (!user || !user.currentQuest || user.currentQuest.completed) return;

    const quest = user.currentQuest;

    if (quest.action === actionName) {
        let progressMade = false;

        if (quest.uniqueTarget && plantId) {
            // For unique targets, track the plantId
            if (!user.questProgressData[plantId]) {
                user.questProgressData[plantId] = true; // Mark this plantId as acted upon
                quest.progress++;
                progressMade = true;
            }
        } else if (!quest.uniqueTarget) {
            // For non-unique targets, just increment progress
            quest.progress++;
            progressMade = true;
        }

        if (progressMade) {
            console.log(`Quest '${quest.id}' progress for ${user.username}: ${quest.progress}/${quest.target}`);

            if (quest.progress >= quest.target) {
                quest.completed = true;
                addScore(user.userId, quest.reward.score, quest.reward.coins);
                addLogEntry(user.username, `a complété la quête: ${quest.description}! (+${quest.reward.score} score, +${quest.reward.coins}p)`);

                // Send completion feedback and update UI immediately
                 io.to(socketId).emit('questUpdate', quest); // Show completed state
                io.to(socketId).emit('actionFeedback', { success: true, message: `Quête "${quest.description}" complétée ! Récompense: ${quest.reward.score} score, ${quest.reward.coins} pièces !`, sound: 'questComplete' });

                // Assign a new quest after a short delay
                setTimeout(() => assignNewQuest(socketId), 4000); // 4 second delay before new quest
            } else {
                 // Send progress update if not completed yet
                 io.to(socketId).emit('questUpdate', quest);
            }
        }
    }
}

// --- Event Management ---
function checkEvent() {
    const now = getCurrentTimestamp();

    if (gameState.currentEvent && now >= gameState.currentEvent.endTime) {
        console.log(`Event ended: ${gameState.currentEvent.name}`);
        addLogEntry("Système", `L'événement "${gameState.currentEvent.name}" est terminé.`);
        gameState.currentEvent = null;
        broadcastEventUpdate();
        saveGameState(); // Save state after event ends
    } else if (!gameState.currentEvent) {
        // Only try to start a new event if none is active
        if (Math.random() < EVENT_CHANCE) {
            startRandomEvent();
        }
    }
    // If an event is active, no need to do anything here until it ends
}

function startRandomEvent() {
    const eventTemplate = randomChoice(EVENTS);
    const now = getCurrentTimestamp();

    gameState.currentEvent = {
        id: eventTemplate.id,
        name: eventTemplate.name,
        description: eventTemplate.description,
        endTime: now + eventTemplate.duration,
        effectMultiplier: eventTemplate.effectMultiplier || {} // Store multipliers
    };

    console.log(`Event started: ${gameState.currentEvent.name} (Ends at: ${new Date(gameState.currentEvent.endTime).toLocaleTimeString()})`);
    addLogEntry("Système", `Événement démarré : ${gameState.currentEvent.name} (${gameState.currentEvent.description})`);
    broadcastEventUpdate();
    saveGameState(); // Save state when event starts
}

// Helper to get event multiplier for a specific effect type
function getEventMultiplier(effectType) {
    // Check if an event is active and has a multiplier for the given type
    return gameState.currentEvent?.effectMultiplier?.[effectType] || 1;
}

// --- Broadcasting ---
function broadcastPlantsUpdate() {
    // console.log("Broadcasting plants update"); // DEBUG
    io.emit('plantsUpdate', gameState.plants);
}
function broadcastLogs() {
    // console.log("Broadcasting logs update"); // DEBUG
    io.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES)); // Send only the most recent logs
}
function broadcastLeaderboard() {
    // console.log("Broadcasting leaderboard update"); // DEBUG
    const topScores = getTopScores(); // Get sorted top scores
    io.emit('leaderboardUpdate', topScores);
}
function broadcastPlayerInfo(socketId) {
    const user = gameState.users[socketId];
    if (user && user.userId && gameState.scores[user.userId]) {
        const scoreData = gameState.scores[user.userId];
        // console.log(`Broadcasting player info to ${socketId} (${user.username})`); // DEBUG
        io.to(socketId).emit('playerInfoUpdate', {
            username: scoreData.username,
            score: scoreData.score,
            coins: scoreData.coins
        });
    } else {
         // console.log(`Skipping player info broadcast to ${socketId} - User or score data missing`); // DEBUG
    }
}
function broadcastEventUpdate() {
    // console.log("Broadcasting event update"); // DEBUG
    io.emit('eventUpdate', gameState.currentEvent); // Send current event status (null if none)
}

// --- Plant Creation ---
function createPlant(creatorId, creatorName, plantNameRequest = null) {
    if (Object.keys(gameState.plants).length >= MAX_PLANTS) {
        console.log("Cannot create plant: Maximum number of plants reached.");
        return null; // Indicate failure
    }

    const now = getCurrentTimestamp();
    const plantId = uuidv4();
    const characteristics = generatePlantCharacteristics();

    // Sanitize and default plant name
    const safeName = String(plantNameRequest || `Plante de ${creatorName}`).trim().substring(0, 30) || `Plante_${plantId.substring(0, 4)}`;

    const newPlant = {
        plantId: plantId,
        name: safeName,
        creatorId: creatorId, // Could be "Système" or a userId
        creatorName: creatorName,
        characteristics: characteristics,

        // Core Status
        health: 100,             // 0-100
        waterLevel: 80,          // 0-100
        energyLevel: 80,         // 0-100 (light energy)
        fertilizerLevel: 10,     // 0-100
        pestLevel: 0,            // 0-100

        // State Flags & Info
        isLightOn: false,
        growthStage: 'GRAINE',
        growthProgress: 0,       // 0-100, percentage towards next stage
        potSize: 'Petit',
        potColor: '#A1887F',     // Default pot color
        isMusicPlaying: false,
        musicEndTime: 0,
        environmentStatus: 'Optimal', // From ENVIRONMENT_STATUSES

        // Timestamps & Tracking
        timeBorn: now,
        lastUpdateTime: now,
        lastWateredBy: "?",
        lastLightToggleBy: "?",
        lastFertilizedBy: "?",
        lastPesticideBy: "?",
        lastRepottedBy: "?",
        lastMusicBy: "?",
        lastCleanedBy: "?",
        lastPrunedBy: "?",

        // Action Cooldown Timestamps (per plant)
        lastTalkTime: 0,
        lastFertilizeTime: 0,
        lastPesticideTime: 0,
        lastRepotTime: 0,
        lastPlayMusicTime: 0,
        lastCleanTime: 0,
        lastPruneTime: 0,
        lastCheckEnvTime: 0,
        lastObserveTime: 0,
        lastHarvestTime: 0,
        lastMistTime: 0,
    };

    gameState.plants[plantId] = newPlant;
    console.log(`Plant created: ID ${plantId}, Name: ${safeName}, Creator: ${creatorName} (${creatorId})`);
    addLogEntry(creatorName, `a créé la plante: ${newPlant.name}`);

    broadcastPlantsUpdate(); // Update all clients about the new plant
    return plantId; // Return the ID of the newly created plant
}


// --- Game Loop Logic ---
function gameLoop() {
    const now = getCurrentTimestamp();
    let needsBroadcast = false; // Flag to check if any plant state changed

    const plantIds = Object.keys(gameState.plants);
    const plantCount = plantIds.length;
    if (plantCount === 0) return; // No plants to update

    // Adjusted environment change chance based on number of plants
    // Lower chance per plant if there are many plants, to avoid constant changes
    const effectiveEnvChangeChance = Math.max(0.005, ENVIRONMENT_CHANGE_CHANCE / Math.sqrt(plantCount));

    for (const plantId of plantIds) {
        const ps = gameState.plants[plantId];
        if (!ps) continue; // Should not happen, but safety check

        const lastUpdate = ps.lastUpdateTime || now; // Use 'now' if lastUpdate is somehow missing
        const timeDiffMs = now - lastUpdate;

        // Skip if no time has passed or time is negative (shouldn't happen)
        if (timeDiffMs <= 0) continue;

        let plantChanged = false; // Flag for changes specific to *this* plant
        const timeDiffHours = timeDiffMs / 3600000.0; // Time difference in hours for rate calculations
        const char = ps.characteristics || {}; // Plant's characteristics

        // --- Calculate Factors ---
        // Tolerance: Higher tolerance means *less* negative effect from extremes (represented by factor < 1)
        const waterTolFactor = char.waterTolerance === 'Haute' ? 0.7 : (char.waterTolerance === 'Basse' ? 1.3 : 1);
        const lightTolFactor = char.lightTolerance === 'Haute' ? 0.7 : (char.lightTolerance === 'Basse' ? 1.3 : 1);
        // Resistance: Higher resistance means *less* negative effect (factor < 1 applied to negative effects)
        // Or *more* positive effect (factor > 1 applied to positive effects, e.g., pest decrease rate)
        const pestResFactor = char.pestResistanceFactor || 1; // Higher value = more resistant
        const envResFactor = char.envResistanceFactor || 1;   // Higher value = more resistant
        // Lifespan: Higher factor means slower negative effects from aging/neglect
        const lifeFactor = char.lifespanFactor || 1;       // Higher value = hardier/longer base life

        const isWilted = ps.health <= 0;
        const isMature = ps.growthStage === 'MATURE' || ps.growthStage === 'FLORAISON';
        const isNeglected = ps.waterLevel < 20 || ps.energyLevel < 20 || ps.health < 50; // Define neglect conditions

        // --- Health Calculation ---
        let healthChange = 0;
        if (!isWilted) {
            // --- Health Loss ---
            // Water stress (too little or too much, modified by tolerance)
            if (ps.waterLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTolFactor;
            if (ps.waterLevel > 98) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * waterTolFactor * 0.5; // Less penalty for overwatering than underwatering

            // Energy stress (too little light, modified by tolerance)
            if (ps.energyLevel < 15) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * lightTolFactor;

            // Pest stress (increases with level, reduced by resistance)
            if (ps.pestLevel > 60) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 1.5 / pestResFactor;
            else if (ps.pestLevel > 30) healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.8 / pestResFactor;

            // Environment stress (non-optimal conditions, reduced by resistance)
            if (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') { // 'Infested' handled by pest stress
                 healthChange -= HEALTH_LOSS_RATE * timeDiffHours * 0.5 / envResFactor;
            }

            // Aging penalty (only if mature AND neglected, reduced by lifespan factor)
            if (isMature && isNeglected) {
                 healthChange -= AGING_HEALTH_LOSS_RATE * timeDiffHours / lifeFactor;
            }

            // --- Health Regeneration ---
            // Requires good conditions (water, energy, low pests, some fertilizer), boosted by lifespan factor
            if (ps.waterLevel > 50 && ps.energyLevel > 50 && ps.pestLevel < 20 && ps.fertilizerLevel > 5) {
                healthChange += HEALTH_REGEN_RATE * timeDiffHours * lifeFactor;
            }

            // Apply health change, clamping between 0 and 100
            const previousHealth = ps.health;
            ps.health = Math.max(0, Math.min(100, ps.health + healthChange));
            if (ps.health !== previousHealth) plantChanged = true;

            // Check if the plant just wilted
            if (ps.health <= 0 && previousHealth > 0) {
                addLogEntry("Système", `La plante "${ps.name}" a flétri...`);
                // Stop music if it was playing
                if (ps.isMusicPlaying) ps.isMusicPlaying = false;
                plantChanged = true; // Ensure update is broadcast
                // Reset growth progress when wilted
                ps.growthProgress = 0;
            }
        }

        // --- Resource Depletion/Gain (Only if not wilted) ---
        if (!isWilted) {
            // Water Depletion (based on need, reduced by lifespan factor)
            const waterNeedFactor = char.waterNeedFactor || 1;
            const waterDepletion = (WATER_DEPLETION_RATE_PER_HOUR * waterNeedFactor / lifeFactor) * timeDiffHours;
            const previousWater = ps.waterLevel;
            ps.waterLevel = Math.max(0, ps.waterLevel - waterDepletion);
            if (ps.waterLevel !== previousWater) plantChanged = true;

            // Energy Gain/Depletion (based on light, need, pests, environment, tolerance)
            const lightNeedFactor = char.lightNeedFactor || 1;
            const pestEffectOnEnergy = Math.max(0.3, (1 - ps.pestLevel / 150)); // Pests reduce energy gain, min 30% efficiency
            const envEffectOnEnergy = (ps.environmentStatus !== 'Optimal' && ps.environmentStatus !== 'Infesté de nuisibles') ? 0.7 : 1; // Bad env reduces gain

            const previousEnergy = ps.energyLevel;
            if (ps.isLightOn) {
                // Gain energy if light is on
                 const energyGain = timeDiffHours * ENERGY_GAIN_RATE_PER_HOUR * lightNeedFactor * pestEffectOnEnergy * envEffectOnEnergy;
                 ps.energyLevel = Math.min(100, ps.energyLevel + energyGain);
                 // Plants with low light tolerance might suffer from too much light (e.g., slight water loss)
                 if (char.lightTolerance === 'Basse' && ps.energyLevel > 95) {
                      const previousWaterBurn = ps.waterLevel;
                      ps.waterLevel = Math.max(0, ps.waterLevel - (timeDiffHours * 2)); // Lose a bit more water
                      if(ps.waterLevel !== previousWaterBurn) plantChanged = true;
                 }
            } else {
                // Lose energy if light is off (modified by light tolerance)
                 const energyDepletion = timeDiffHours * ENERGY_DEPLETION_RATE_PER_HOUR * lightNeedFactor * envEffectOnEnergy * lightTolFactor;
                 ps.energyLevel = Math.max(0, ps.energyLevel - energyDepletion);
            }
             if (ps.energyLevel !== previousEnergy) plantChanged = true;


            // Fertilizer Depletion (based on need)
            const fertNeedFactor = char.fertilizerNeedFactor || 1;
            const fertDepletion = timeDiffHours * FERTILIZER_DEPLETION_RATE_PER_HOUR * fertNeedFactor;
            const previousFert = ps.fertilizerLevel;
            ps.fertilizerLevel = Math.max(0, ps.fertilizerLevel - fertDepletion);
            if (ps.fertilizerLevel !== previousFert) plantChanged = true;

            // Pest Level Change (affected by conditions, resistance, events, environment)
            let pestChange = 0;
            const pestResistEventMultiplier = getEventMultiplier('pest_resist'); // Get event multiplier
            // Poor conditions increase pests (less effect from resistance)
            if (ps.waterLevel < 40 || ps.energyLevel < 40) {
                 pestChange = timeDiffHours * PEST_INCREASE_RATE_PER_HOUR * 1.5 / (pestResFactor * 0.8); // Resistance helps less here
            }
            // Good conditions decrease pests (boosted by resistance and events)
            else if (ps.waterLevel > 80 && ps.energyLevel > 80) {
                 pestChange = -(timeDiffHours * PEST_DECREASE_RATE_PER_HOUR * pestResFactor * pestResistEventMultiplier);
            }
            // Neutral conditions: slight increase (reduced by resistance)
            else {
                 pestChange = timeDiffHours * PEST_INCREASE_RATE_PER_HOUR * 0.5 / pestResFactor;
            }
             // Environment effects on pests
             if (ps.environmentStatus === 'Infesté de nuisibles') pestChange *= 2; // Double increase/halve decrease
             if (ps.environmentStatus === 'Optimal') pestChange *= 0.5; // Halve increase/double decrease
             const previousPest = ps.pestLevel;
             ps.pestLevel = Math.max(0, Math.min(100, ps.pestLevel + pestChange));
            if (ps.pestLevel !== previousPest) plantChanged = true;

            // Music wears off
            if (ps.isMusicPlaying && now >= ps.musicEndTime) {
                ps.isMusicPlaying = false;
                plantChanged = true;
                // addLogEntry("Système", `La musique s'est arrêtée pour ${ps.name}.`); // Optional log
            }

            // Random Environment Change Check for this specific plant
             if (Math.random() < effectiveEnvChangeChance * timeDiffHours) { // Chance scales with time passed
                 const oldEnv = ps.environmentStatus;
                 ps.environmentStatus = getRandomEnvStatus(ps.pestLevel);
                 if (ps.environmentStatus !== oldEnv) {
                     // addLogEntry("Système", `L'environnement de ${ps.name} est devenu ${ps.environmentStatus}.`); // Optional log
                     plantChanged = true;
                 }
             }
        } // End resource update (!isWilted)

        // --- Growth Check --- (Using Updated Logic) ---
        const currentStage = ps.growthStage;
        const stageData = GROWTH_STAGES[currentStage];
        let previousGrowthProgress = ps.growthProgress || 0; // Store previous progress

        // Only check growth if healthy, not wilted, and not already at final stage
        if (ps.health > 50 && !isWilted && stageData && stageData.t !== Infinity) {
            const nextStageKey = stageData.nt; // Get the key for the next stage
            const nextStageData = nextStageKey ? GROWTH_STAGES[nextStageKey] : null;

            if (nextStageData) { // Ensure there is a next stage defined
                 const growthRateEventMultiplier = getEventMultiplier('growth');
                 const growthRate = (char.growthRateFactor || 1) * growthRateEventMultiplier;
                 const healthFactor = (ps.health >= 70) ? 1 : 0.8; // Slight penalty below 70 health
                 const potFactor = (ps.potSize === 'Petit' && (currentStage === 'JEUNE' || currentStage === 'MATURE' || currentStage === 'FLORAISON')) ? 0.6
                                 : (ps.potSize === 'Moyen' && (currentStage === 'MATURE' || currentStage === 'FLORAISON')) ? 0.8
                                 : 1;
                 const fertilizerBonus = (1 + (ps.fertilizerLevel / 150)); // Bonus from fertilizer

                // Accumulate growth potential based on time and factors
                // We use timeBorn as the baseline and apply factors cumulatively
                // NOTE: Re-evaluating this each loop might be slightly inaccurate if factors change often,
                // but it's simpler than tracking growth increments precisely.
                 const effectiveTimeAliveMs = (now - ps.timeBorn) * growthRate * fertilizerBonus * potFactor * healthFactor;

                const currentTimeThreshold = stageData.t;       // ms threshold to *reach* current stage
                 const nextTimeThreshold = nextStageData.t; // ms threshold to *reach* next stage
                 const stageDuration = nextTimeThreshold - currentTimeThreshold;

                // Calculate progress within the current stage (0-100)
                 if (stageDuration > 0) {
                     const timeSpentTowardsNext = effectiveTimeAliveMs - currentTimeThreshold;
                     ps.growthProgress = Math.max(0, Math.min(100, (timeSpentTowardsNext / stageDuration) * 100));
                 } else {
                     ps.growthProgress = 0; // Avoid division by zero if thresholds are same (shouldn't be)
                 }

                // Check for stage transition
                 if (effectiveTimeAliveMs >= nextTimeThreshold) {
                     // console.log(`Growth Check: ${ps.name} - EffectiveTime: ${Math.round(effectiveTimeAliveMs / 36e5)}h >= NextThreshold: ${Math.round(nextTimeThreshold / 36e5)}h`); // Debug
                     ps.growthStage = nextStageKey;
                     ps.growthProgress = 0; // Reset progress for the new stage
                     const newStageInfo = GROWTH_STAGES[ps.growthStage];
                     addLogEntry("Système", `"${ps.name}" a grandi et est maintenant: ${newStageInfo.n}!`);
                     if (ps.creatorId && ps.creatorId !== "Système") {
                         addScore(ps.creatorId, SCORE_PER_GROWTH);
                         if (ps.growthStage === 'FLORAISON') {
                             addScore(ps.creatorId, SCORE_PER_FLOWER);
                             addLogEntry("Système", `"${ps.name}" est en fleur! 🌸`);
                         }
                     }
                     plantChanged = true;
                 }
                 // Update change flag even if no stage transition, if progress changed
                 else if (Math.abs(ps.growthProgress - previousGrowthProgress) > 0.1) {
                     plantChanged = true;
                 }

            } else { // Reached final stage (e.g., Floraison)
                 ps.growthProgress = 100;
                 if (previousGrowthProgress !== 100) plantChanged = true; // Mark changed if it just hit 100
            }
        } else if (isWilted) {
            // Reset progress if wilted
            ps.growthProgress = 0;
            if (previousGrowthProgress !== 0) plantChanged = true;
        } else if (stageData && stageData.t === Infinity) {
            // Ensure progress is 100 if stage duration is infinite (final stage)
            ps.growthProgress = 100;
            if (previousGrowthProgress !== 100) plantChanged = true;
        }
        // --- End Growth Check ---

        // Set last update time for this plant
        ps.lastUpdateTime = now;

        // Aggregate change flag
        if (plantChanged) {
            needsBroadcast = true;
        }

    } // End plant loop

    // Broadcast updates if any plant changed
    if (needsBroadcast) {
        broadcastPlantsUpdate();
    }

    // Check save interval
    if (now - lastSaveTime >= SAVE_INTERVAL) {
        saveGameState();
    }
} // End gameLoop


// --- Server Setup & Socket Handling ---
app.use(express.static(__dirname)); // Serve static files from the current directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    const socketId = socket.id;
    // Generate a unique userId for this session
    const userId = uuidv4();
    const initialUsername = `Jardinier_${userId.substring(0, 4)}`;

    // Store user data associated with the socket connection
    gameState.users[socketId] = {
        userId: userId,
        username: initialUsername,
        // Store last action times for user-specific cooldowns (like createPlant)
        lastCreateTime: 0,
        lastWaterAllTime: 0,
        currentQuest: null,
        questProgressData: {} // For tracking unique targets in quests
    };

    console.log(`User connected: SocketID ${socketId}, UserID ${userId}, Username: ${initialUsername}`);

    // Initialize or update score entry for the user
    if (!gameState.scores[userId]) {
        gameState.scores[userId] = { username: initialUsername, score: 0, coins: 0 };
    } else {
        // If user reconnects, update their username in the score entry if needed
        gameState.scores[userId].username = initialUsername;
        gameState.scores[userId].coins = gameState.scores[userId].coins || 0; // Ensure coins exist
    }

    // Assign initial quest
    assignNewQuest(socketId);

    // --- Send initial state to the newly connected client ---
    socket.emit('userId', userId); // Send the generated userId to the client
    socket.emit('usernameUpdate', initialUsername); // Send the initial username
    socket.emit('plantsUpdate', gameState.plants); // Send current state of all plants
    socket.emit('logsUpdate', gameState.logs.slice(0, MAX_LOG_ENTRIES)); // Send recent logs
    socket.emit('leaderboardUpdate', getTopScores()); // Send current leaderboard
    socket.emit('questUpdate', gameState.users[socketId].currentQuest); // Send assigned quest
    socket.emit('eventUpdate', gameState.currentEvent); // Send current event status
    socket.emit('shopItemsUpdate', SHOP_ITEMS); // Send available shop items
    broadcastPlayerInfo(socketId); // Send initial score/coins

    // --- Handle client events ---

    socket.on('setUsername', (newName) => {
        const user = gameState.users[socketId];
        if (!user) return; // Should not happen

        const cleanName = String(newName || '').trim().substring(0, 20); // Sanitize name
        if (cleanName && cleanName !== user.username) {
            const oldName = user.username;
            user.username = cleanName;
            updateScoreUsername(user.userId, cleanName); // Update username in score table
            console.log(`User ${socketId} (${oldName}) set username to: ${cleanName}`);
            addLogEntry("Système", `"${oldName}" est maintenant connu comme "${cleanName}"`);
            broadcastLeaderboard(); // Update leaderboard as username changed
            // Optionally broadcast player info again if needed elsewhere
            // broadcastPlayerInfo(socketId);
             // Send confirmation back to user
             socket.emit('usernameUpdate', cleanName);
        }
    });

    // --- Generic Action Handler v7.3 ---
    const actions = {
        waterPlant: {
            cooldown: 0, // No specific cooldown per plant, relies on click rate limit if any
            score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'), // Use function if score depends on event
            effect: (ps, user, username) => { ps.waterLevel = Math.min(100, ps.waterLevel + WATER_PER_CLICK); ps.health = Math.min(100, ps.health + 1); ps.lastWateredBy = username; },
            logMsg: "a arrosé"
        },
        toggleLight: {
            cooldown: 0,
            score: () => 0,
            effect: (ps, user, username) => { ps.isLightOn = !ps.isLightOn; ps.lastLightToggleBy = username; },
            logMsgDynamic: (ps) => `a ${ps.isLightOn ? 'allumé' : 'éteint'} la lumière pour` // Dynamic message based on state AFTER action
        },
        cleanLeaves: {
            cooldown: CLEAN_LEAVES_COOLDOWN,
            score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'),
            lastActionTimeKey: 'lastCleanTime',
            effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + CLEAN_LEAVES_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 1); ps.lastCleanedBy = username; },
            logMsg: "a nettoyé les feuilles de"
        },
        gentleMist: {
             cooldown: MIST_COOLDOWN,
             score: () => SCORE_PER_MIST * getEventMultiplier('care_score'),
             lastActionTimeKey: 'lastMistTime',
             effect: (ps, user, username) => { ps.waterLevel = Math.min(100, ps.waterLevel + MIST_WATER_BOOST); ps.energyLevel = Math.min(100, ps.energyLevel + MIST_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.5); /* No specific user tracking needed? */},
             logMsg: "a brumisé"
        },
        fertilizePlant: {
            cooldown: FERTILIZE_COOLDOWN,
            score: () => SCORE_PER_ACTION,
            lastActionTimeKey: 'lastFertilizeTime',
            effect: (ps, user, username) => { ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + (FERTILIZER_PER_CLICK * getEventMultiplier('fertilizer'))); ps.health = Math.min(100, ps.health + 2); ps.lastFertilizedBy = username; },
            logMsg: "a fertilisé"
        },
        applyPesticide: {
            cooldown: PESTICIDE_COOLDOWN,
            score: () => SCORE_PER_ACTION,
            lastActionTimeKey: 'lastPesticideTime',
            condition: (ps) => ps.pestLevel > 5, // Only allow if pests are present
            effect: (ps, user, username) => { ps.pestLevel = Math.max(0, ps.pestLevel - PESTICIDE_EFFECT); ps.lastPesticideBy = username; },
            logMsg: "a appliqué du pesticide sur"
        },
        prunePlant: {
            cooldown: PRUNE_COOLDOWN,
            score: () => SCORE_PER_ACTION,
            lastActionTimeKey: 'lastPruneTime',
            condition: (ps) => GROWTH_STAGES[ps.growthStage]?.p, // Check if stage allows pruning
            effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + PRUNE_HEALTH_BOOST); /* Pruning might consume some water? ps.waterLevel = Math.max(0, ps.waterLevel - 5); */ ps.health = Math.min(100, ps.health + PRUNE_HEALTH_BOOST); ps.lastPrunedBy = username; },
            logMsg: "a taillé"
        },
        repotPlant: {
            cooldown: REPOT_COOLDOWN,
            score: () => SCORE_PER_ACTION * 2,
            lastActionTimeKey: 'lastRepotTime',
            condition: (ps) => GROWTH_STAGES[ps.growthStage]?.r && ps.potSize !== 'Large', // Check stage and current size
            effect: (ps, user, username) => { const oldSize = ps.potSize; if (oldSize === 'Petit') ps.potSize = 'Moyen'; else if (oldSize === 'Moyen') ps.potSize = 'Large'; ps.fertilizerLevel = Math.max(0, ps.fertilizerLevel - 20); ps.health = Math.min(100, ps.health + 10); ps.lastRepottedBy = username; },
            logMsgDynamic: (ps) => `a rempoté dans un pot ${ps.potSize}`
        },
        harvestSeed: {
            cooldown: HARVEST_COOLDOWN,
            score: () => SCORE_PER_SEED,
            coins: () => COINS_PER_HARVEST * getEventMultiplier('harvest_coins'), // Use function for event multiplier
            lastActionTimeKey: 'lastHarvestTime',
            condition: (ps) => ps.growthStage === 'FLORAISON', // Only harvestable when flowering
            effect: (ps, user, username) => { /* Maybe slightly reduces health or energy? ps.energyLevel = Math.max(0, ps.energyLevel - 10); */ },
            logMsg: "a récolté une graine de"
        },
        talkToPlant: {
            cooldown: TALK_COOLDOWN,
            score: () => SCORE_PER_ACTION * getEventMultiplier('care_score'),
            lastActionTimeKey: 'lastTalkTime',
            effect: (ps, user, username) => { ps.energyLevel = Math.min(100, ps.energyLevel + TALK_ENERGY_BOOST); ps.health = Math.min(100, ps.health + 0.2); /* No specific user tracking */ },
            logMsg: "a parlé gentiment à"
        },
        playMusic: {
            cooldown: PLAY_MUSIC_COOLDOWN,
            score: () => SCORE_PER_ACTION,
            lastActionTimeKey: 'lastPlayMusicTime',
            condition: (ps) => !ps.isMusicPlaying, // Can't start if already playing
            effect: (ps, user, username) => { ps.isMusicPlaying = true; ps.musicEndTime = getCurrentTimestamp() + MUSIC_DURATION; ps.lastMusicBy = username; },
            logMsg: "a joué de la musique pour"
        },
        observePlant: {
            cooldown: OBSERVE_COOLDOWN,
            score: () => SCORE_PER_OBSERVE,
            lastActionTimeKey: 'lastObserveTime',
            effect: (ps, user, username, socket) => { // Effect needs socket to send feedback
                 const char = ps.characteristics || {};
                 let observations = [];
                 // Tolerances
                 if (char.waterTolerance === 'Basse') observations.push("Semble sensible aux excès/manques d'eau.");
                 if (char.waterTolerance === 'Haute') observations.push("Tolère bien les variations d'eau.");
                 if (char.lightTolerance === 'Basse') observations.push("Préfère une lumière stable.");
                 if (char.lightTolerance === 'Haute') observations.push("S'adapte bien à différentes lumières.");
                 // Needs
                 if ((char.waterNeedFactor || 1) < 0.9) observations.push("A besoin de moins d'eau que la moyenne.");
                 if ((char.waterNeedFactor || 1) > 1.1) observations.push("A besoin de plus d'eau que la moyenne.");
                 if ((char.lightNeedFactor || 1) < 0.9) observations.push("A besoin de moins de lumière.");
                 if ((char.lightNeedFactor || 1) > 1.1) observations.push("A besoin de plus de lumière.");
                // Resistances
                 if ((char.pestResistanceFactor || 1) < 0.9) observations.push("Est assez sensible aux nuisibles.");
                 if ((char.pestResistanceFactor || 1) > 1.1) observations.push("Est plutôt résistante aux nuisibles.");
                 if ((char.envResistanceFactor || 1) < 0.9) observations.push("Sensible aux changements d'environnement.");
                 if ((char.envResistanceFactor || 1) > 1.1) observations.push("Résiste bien aux changements d'environnement.");
                // Visuals
                 observations.push(`Feuilles: ${char.leafShape || 'Forme inconnue'}.`);
                 if (ps.growthStage === 'FLORAISON') observations.push(`Fleurs: Couleur ${char.flowerColor || 'inconnue'}.`);
                // Rare Trait
                 if (char.rareTrait) {
                      const traitInfo = RARE_TRAITS.find(t => t.n === char.rareTrait);
                      observations.push(`Trait Spécial: ${char.rareTrait}! ${traitInfo?.d || ''}`);
                 }
                // Feedback
                 const feedbackText = observations.length > 0 ? observations.join(' ') : "Semble être une plante tout à fait normale.";
                 socket.emit('plantObservation', { plantId: ps.plantId, text: feedbackText });
            },
            logMsg: "a observé"
        },
        checkEnvironment: {
            cooldown: ENV_CHECK_COOLDOWN,
            score: () => 0,
            lastActionTimeKey: 'lastCheckEnvTime',
            effect: (ps, user, username) => { /* No direct effect on plant */ },
            logMsgDynamic: (ps) => `a vérifié l'environnement (${ps.environmentStatus}) de`
        }
    };

    // Register listeners for each action
    for (const actionName in actions) {
        socket.on(actionName, (data) => {
            const user = gameState.users[socketId];
            if (!user) { console.warn(`Action ${actionName} attempt by disconnected socket ${socketId}`); return; } // Ignore if user somehow not found

            const userId = user.userId;
            const username = user.username;
            const plantId = data?.plantId; // Get plantId from data sent by client
            const ps = gameState.plants[plantId]; // Get plant state

            if (!ps) {
                 console.warn(`Action '${actionName}' on unknown or missing plant ID '${plantId}' by ${username}`);
                 socket.emit('actionFeedback', { success: false, message: "Plante introuvable." });
                 return;
            }

            const actionConfig = actions[actionName];
            const now = getCurrentTimestamp();

            // 1. Check Cooldown (if applicable)
            if (actionConfig.cooldown > 0 && actionConfig.lastActionTimeKey) {
                if ((now - (ps[actionConfig.lastActionTimeKey] || 0)) < actionConfig.cooldown) {
                    // console.log(`Action ${actionName} on cooldown for ${username} on ${ps.name}`); // DEBUG
                    // Optionally send feedback about cooldown
                    // socket.emit('actionFeedback', { success: false, message: "Action en cooldown." });
                    // Log attempt quietly or not at all to reduce spam
                    // addLogEntry(username, `a essayé ${actionName} (cooldown)`, ps.name);
                    return; // Stop processing
                }
            }

             // 2. Check Health (Cannot interact with wilted plants)
             if (ps.health <= 0) {
                 addLogEntry(username, `a essayé ${actionName} sur ${ps.name} (flétrie)`, null); // Log without plant name in action?
                 socket.emit('actionFeedback', { success: false, message: "Cette plante est flétrie." });
                 return;
             }

             // 3. Check Condition (if applicable)
            if (actionConfig.condition && !actionConfig.condition(ps)) {
                // console.log(`Action ${actionName} condition not met for ${username} on ${ps.name}`); // DEBUG
                // Send specific feedback if needed, or generic failure
                 socket.emit('actionFeedback', { success: false, message: "Action impossible dans ces conditions." });
                 addLogEntry(username, `a essayé ${actionName} sur ${ps.name} (condition échouée)`, null);
                 return;
            }

            // --- If all checks pass, execute the action ---

            // 4. Apply Effect
            actionConfig.effect(ps, user, username, socket); // Pass user, username, and socket if needed

            // 5. Update Timestamps
            ps.lastUpdateTime = now; // Mark plant as updated
            if (actionConfig.lastActionTimeKey) {
                ps[actionConfig.lastActionTimeKey] = now; // Update last action time for cooldown
            }

            // 6. Add Score/Coins (use function calls to handle event multipliers)
             const scoreToAdd = typeof actionConfig.score === 'function' ? actionConfig.score() : (actionConfig.score || 0);
             const coinsToAdd = typeof actionConfig.coins === 'function' ? actionConfig.coins() : (actionConfig.coins || 0);
             if (scoreToAdd > 0 || coinsToAdd > 0) {
                  addScore(userId, scoreToAdd, coinsToAdd);
             }

            // 7. Check Quest Progress
            checkQuestProgress(socketId, actionName, plantId);

            // 8. Log Action
            const logMessage = actionConfig.logMsgDynamic ? actionConfig.logMsgDynamic(ps) : actionConfig.logMsg;
            addLogEntry(username, logMessage, ps.name); // Pass plant name for context in log

            // 9. Broadcast Updates (potentially optimize later if needed)
            broadcastPlantsUpdate();       // Update everyone's view of the plants
            broadcastPlayerInfo(socketId); // Update the acting player's score/coin display

             // 10. Optional: Send specific success feedback
             // socket.emit('actionFeedback', { success: true, message: `${actionName} réussi!` });
        });
    }

    // --- Specific Actions Not Covered by Generic Handler ---

    socket.on('createPlant', (data) => {
        const user = gameState.users[socketId];
        if (!user) return;
        const now = getCurrentTimestamp();

        // Check user-specific cooldown for creating plants
        if (now - user.lastCreateTime < CREATE_PLANT_COOLDOWN) {
            addLogEntry(user.username, "a essayé de créer une plante (cooldown)");
            socket.emit('actionFeedback', { success: false, message: "Vous devez attendre avant de créer une nouvelle plante." });
            return;
        }
        // Check global plant limit
        if (Object.keys(gameState.plants).length >= MAX_PLANTS) {
            addLogEntry(user.username, "a essayé de créer une plante (max atteint)");
            socket.emit('actionFeedback', { success: false, message: "Le jardin est plein ! Impossible de créer plus de plantes." });
            return;
        }

        const plantNameRequest = data?.plantName; // Get requested name from client data
        const newPlantId = createPlant(user.userId, user.username, plantNameRequest);

        if (newPlantId) {
            user.lastCreateTime = now; // Update cooldown timestamp for the user
            socket.emit('actionFeedback', { success: true, message: `Nouvelle plante "${gameState.plants[newPlantId].name}" créée avec succès !`, sound: 'create' });
             // Detail view might need an update if it was showing placeholder - client should handle this based on plantsUpdate
        } else {
            // Creation failed (likely hit max plants between check and creation, though unlikely)
            socket.emit('actionFeedback', { success: false, message: "Erreur lors de la création de la plante." });
        }
    });

    socket.on('waterAllPlants', () => {
        const user = gameState.users[socketId];
        if (!user) return;
        const now = getCurrentTimestamp();

        // Check user-specific cooldown
        if (now - user.lastWaterAllTime < WATER_ALL_COOLDOWN) {
            addLogEntry(user.username, "a essayé 'Tout Arroser' (cooldown)");
            socket.emit('actionFeedback', { success: false, message: "Cooldown 'Tout Arroser'." });
            return;
        }

        let wateredCount = 0;
        let totalScore = 0;
        let needsUpdate = false;
        const careScoreMultiplier = getEventMultiplier('care_score'); // Check for care bonus event

        for (const plantId in gameState.plants) {
            const ps = gameState.plants[plantId];
            // Water only if plant exists, is not wilted, and water level is not already full
            if (ps && ps.health > 0 && ps.waterLevel < 95) { // Threshold to avoid topping off full plants
                 ps.waterLevel = Math.min(100, ps.waterLevel + WATER_ALL_BOOST);
                 ps.lastUpdateTime = now; // Mark as updated
                 ps.lastWateredBy = user.username; // Track who watered last
                 wateredCount++;
                 totalScore += SCORE_PER_ACTION * careScoreMultiplier; // Apply potential bonus
                 needsUpdate = true;
            }
        }

        if (wateredCount > 0) {
            user.lastWaterAllTime = now; // Update cooldown timestamp
            addScore(user.userId, totalScore, 0); // Add calculated score
            addLogEntry(user.username, `a utilisé 'Tout Arroser' (${wateredCount} plante(s))`);
            if (needsUpdate) broadcastPlantsUpdate(); // Update plant visuals
            broadcastPlayerInfo(socketId); // Update player's score display
            socket.emit('actionFeedback', { success: true, message: `${wateredCount} plante(s) arrosée(s) !`, sound: 'water' });
        } else {
            addLogEntry(user.username, "a essayé 'Tout Arroser' (aucune plante à arroser)");
            socket.emit('actionFeedback', { success: false, message: "Aucune plante n'avait besoin d'être arrosée." });
        }
    });

     socket.on('buyItem', (data) => {
         const user = gameState.users[socketId];
         if (!user) return;
         const userId = user.userId;
         const username = user.username;

         const itemId = data?.itemId;
         const targetPlantId = data?.plantId; // Used for cosmetics/consumables applied to a specific plant
         const item = SHOP_ITEMS[itemId];
         const playerScore = gameState.scores[userId];

         if (!item) {
              socket.emit('actionFeedback', { success: false, message: "Objet inconnu dans la boutique." });
              return;
         }

         if (!playerScore || (playerScore.coins || 0) < item.price) {
              socket.emit('actionFeedback', { success: false, message: "Pièces insuffisantes pour acheter cet objet." });
              return;
         }

         // --- Process Purchase ---
         console.log(`${username} trying to buy ${item.name} (${itemId}) for ${item.price} coins.`);

         // 1. Deduct cost FIRST
         addScore(userId, 0, -item.price);
         let purchaseSuccessful = false;
         let feedbackMsg = '';
         let feedbackSound = 'error';

         // 2. Handle item effect based on type
         try {
              if (item.type === 'seed') {
                   // Check plant limit *before* creating
                   if (Object.keys(gameState.plants).length >= MAX_PLANTS) {
                         feedbackMsg = "Achat échoué: le jardin est plein.";
                         addScore(userId, 0, item.price); // Refund cost
                   } else {
                         const newPlantId = createPlant(userId, username, `Graine ${item.name}`);
                         if (newPlantId) {
                              feedbackMsg = `${item.name} achetée et plantée !`;
                              feedbackSound = 'buy';
                              purchaseSuccessful = true;
                              addLogEntry(username, `a acheté et planté: ${item.name}`);
                         } else {
                              feedbackMsg = "Achat échoué lors de la plantation.";
                              addScore(userId, 0, item.price); // Refund cost
                         }
                   }
              }
              else if (item.type === 'cosmetic') {
                   if (itemId.startsWith('pot_') && targetPlantId && gameState.plants[targetPlantId]) {
                        gameState.plants[targetPlantId].potColor = item.value;
                        feedbackMsg = `${item.name} appliqué à ${gameState.plants[targetPlantId].name} !`;
                        feedbackSound = 'buy';
                        purchaseSuccessful = true;
                        addLogEntry(username, `a acheté ${item.name} pour ${gameState.plants[targetPlantId].name}`);
                        broadcastPlantsUpdate(); // Update visuals
                   } else {
                        feedbackMsg = "Achat échoué: Plante cible invalide pour ce cosmétique.";
                        addScore(userId, 0, item.price); // Refund cost
                   }
              }
              else if (item.type === 'consumable' || item.type === 'boost') {
                   const ps = gameState.plants[targetPlantId];
                   if (!ps) {
                        feedbackMsg = "Achat échoué: Plante cible invalide.";
                        addScore(userId, 0, item.price); // Refund
                   } else if (ps.health <= 0) {
                        feedbackMsg = "Impossible d'utiliser sur une plante flétrie.";
                        addScore(userId, 0, item.price); // Refund
                   } else {
                        // Apply effect based on item definition
                        if (item.effect === 'pesticide' && item.amount) {
                             ps.pestLevel = Math.max(0, ps.pestLevel - item.amount);
                             feedbackMsg = `${item.name} utilisé sur ${ps.name} !`;
                             feedbackSound = 'buy'; // Or a specific 'spray' sound
                             purchaseSuccessful = true;
                             addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`);
                             broadcastPlantsUpdate();
                        } else if (item.effect === 'fertilizer' && item.amount) {
                             // TODO: Implement proper boost logic with duration if needed
                             // For now, apply instant amount
                             ps.fertilizerLevel = Math.min(100, ps.fertilizerLevel + item.amount);
                             feedbackMsg = `${item.name} utilisé sur ${ps.name} !`;
                             feedbackSound = 'buy'; // Or a specific 'fertilize' sound
                             purchaseSuccessful = true;
                             addLogEntry(username, `a utilisé ${item.name} sur ${ps.name}`);
                             broadcastPlantsUpdate();
                        }
                        // Add more consumable/boost effects here if needed
                       else {
                            feedbackMsg = "Effet d'objet inconnu ou non implémenté.";
                            addScore(userId, 0, item.price); // Refund
                       }
                   }
              }
              else {
                   feedbackMsg = "Type d'objet inconnu.";
                   addScore(userId, 0, item.price); // Refund
              }
         } catch (error) {
              console.error(`Error processing purchase for ${username} item ${itemId}:`, error);
              feedbackMsg = "Erreur lors de l'application de l'objet.";
              addScore(userId, 0, item.price); // Refund on error
         }


         // 3. Send feedback and update player info
         socket.emit('actionFeedback', { success: purchaseSuccessful, message: feedbackMsg, sound: feedbackSound });
         broadcastPlayerInfo(socketId); // Update coins display for the buyer
         if (purchaseSuccessful) {
              saveGameState(); // Save state after a successful purchase that modified state
         }
     });

    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: SocketID ${socketId}, Reason: ${reason}`);
        const user = gameState.users[socketId];
        if (user) {
            addLogEntry("Système", `"${user.username}" s'est déconnecté.`);
            // Note: Score data in gameState.scores is kept, but user entry is removed
            delete gameState.users[socketId];
        }
        // Leaderboard will update automatically on next interval
    });
});

// --- Leaderboard Utility ---
function getTopScores(count = 10) {
    // Convert scores object to an array, sort, and take top 'count'
    return Object.entries(gameState.scores)
        .map(([userId, data]) => ({
            userId: userId,
            username: data.username || 'Anonyme',
            score: data.score || 0,
            coins: data.coins || 0
        }))
        .sort((a, b) => b.score - a.score) // Sort descending by score
        .slice(0, count);
}

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`------------------------------------------`);
    console.log(` 🌱 Jardin Communautaire Server v7.3 🌱 `);
    console.log(`    Server listening on port ${PORT}`);
    console.log(`------------------------------------------`);

    loadGameState(); // Load existing state or initialize

    // Clear existing timers if any (e.g., during hot reload)
    if (gameLoopTimer) clearInterval(gameLoopTimer);
    if (leaderboardUpdateTimer) clearInterval(leaderboardUpdateTimer);
    if (eventTimer) clearInterval(eventTimer);

    // Start game loops and intervals
    gameLoopTimer = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    leaderboardUpdateTimer = setInterval(broadcastLeaderboard, LEADERBOARD_UPDATE_INTERVAL);
    eventTimer = setInterval(checkEvent, EVENT_CHECK_INTERVAL);

    console.log("Game loops (Game, Leaderboard, Events) started.");
});

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    // Clear intervals
    if (gameLoopTimer) clearInterval(gameLoopTimer);
    if (leaderboardUpdateTimer) clearInterval(leaderboardUpdateTimer);
    if (eventTimer) clearInterval(eventTimer);
    console.log("Game loops stopped.");

    // Save final game state before exiting
    console.log("Performing final save...");
    try {
         // Use synchronous save on shutdown to ensure it completes
         const dataToSave = { plants: gameState.plants, scores: gameState.scores, logs: gameState.logs, currentEvent: gameState.currentEvent };
         fs.writeFileSync(GAMESTATE_FILE, JSON.stringify(dataToSave), 'utf8');
         console.log("Final game state saved successfully.");
    } catch (error) {
         console.error("Error during final save:", error);
    }

    // Close server and exit
    server.close(() => {
        console.log("Server closed.");
        process.exit(0);
    });
});