//==============================================================================
// Registers a node locally (using local storage)
//==============================================================================

var LocalStorage = require('node-localstorage').LocalStorage,
    lockFile = require('lockfile'),
    constants = require('./constants'),
    logger = require('./jerrlog'),
    Registry = require('./registry'),
    os = require('os');

/* create an mDNS advertisement on the local network */

function LocalRegistry(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.ip = this._getIPv4Address();
    this.localStorage = null;
    this.binName = this._getBinName();
    // put the 'app' as a hidden directory in user's home
    this.appDir = os.homedir() + '/.' + app;
    this.lastScanAt = 0;
    this.currentOfflineMachs = {};
    this.discoveryKeys = [];
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

/**
 * API for local storage registration/discovery
 */
LocalRegistry.prototype.registerAndDiscover = function() {
    // initialize the local storage
    var self = this;
    this._initLocalStorage(this, function() {
        // initialization complete; begin actual registration/discovery
        self._register(self);
        self._discover(self);
        self.emit('ls-reg-success');
    });
}

LocalRegistry.prototype._initLocalStorage = function(self, cb) {
    lockFile.lock(constants.localStorage.initLock, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            // failed to acquire lock, which means someone else already has it; wait until the node with the lock
            // has finished initializing local storage
            grabbedLock = false;
            var tempLs;
            while (true) {
                tempLs = new LocalStorage(self.appDir);
                if (tempLs.getItem('initialized')) {
                    self.localStorage = tempLs;
                    break;
                }
            }
            self.emit('ls-initialized');
            cb();
            return;
        }

        // we've grabbed the lock
        self.localStorage = new LocalStorage(self.appDir);
        if (!self.localStorage.getItem('initialized')) {
            // we need to perform the initialization
            for (var i = 0; i < constants.localStorage.numBins; i++) {
                self.localStorage.setItem('fogs_' + i, '{}');
                self.localStorage.setItem('clouds_' + i, '{}');
            }
            self.localStorage.setItem('initialized', 'true');
        }
        lockFile.unlockSync(constants.localStorage.initLock);
        self.emit('ls-initialized');
        cb();
    });
}

/**
 * Register a node on local storage by having it write itself into local storage (fogs and clouds only)
 */
LocalRegistry.prototype._register = function(self) {
    // create an object to be written to local storage
    var now = Date.now();
    var data = {
        ip: self._getIPv4Address(),
        port: self.port,
        lastCheckIn: now,
        createdAt: now,
        updatedAt: now,
        default: true
    };

    self._addNodeToLocalStorage(data, 1, self, function() {
        // check in every so often to indicate that we're still here
        setInterval(self._checkIn, constants.localStorage.checkInInterval, 1, self);
    });
}

/**
 * API for local storage discovery of nodes with the given key(s)
 */
LocalRegistry.prototype.discover = function(keys) {
    this._discover(this, keys);
}

LocalRegistry.prototype._discover = function(self, keys) {
    if (keys !== undefined) {
        if (keys.constructor === Array) {
            self.discoveryKeys = self.discoveryKeys.concat(keys);
        } else {
            self.discoveryKeys.push(keys);
        }
    }
    if (!self.scanning) {
        if (self.localStorage !== null) {
            self._beginScanning(self);
        } else {
            self.on('ls-initialized', function() {
                self._beginScanning(self);
            });
        }
    }
}

/**
 * Kick-start scanning
 * TODO: this will have to be changed when we add custom discoveries
 */
LocalRegistry.prototype._beginScanning = function(self) {
    if (self.machType === constants.globals.NodeType.DEVICE || self.machType === constants.globals.NodeType.FOG) {
        self._scan(self);
        setInterval(self._scan, constants.localStorage.scanInterval, self);
    } else {
        // Nothing for now (clouds don't scan by default)
    }
    this.scanning = true;
}

LocalRegistry.prototype.stopDiscovering = function(key) {
    var index = this.discoveryKeys.indexOf(key);
    if (index !== -1) {
        this.discoveryKeys.splice(index, 1);
    }
}

/**
 * Attributes are custom, discoverable features of nodes
 * An attribute is discoverable by its `key`
 */
LocalRegistry.prototype.addAttribute = function(key, value) {
    if (this.binName !== undefined) {
        this._addAttributeWithRetry(key, value, 1, this);
    }
}

LocalRegistry.prototype._addAttributeWithRetry = function(key, value, attemptNumber, self) {
    lockFile.lock(this.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._addAttributeWithRetry, self._getWaitTime(attemptNumber), key, value, attemptNumber + 1, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(this.binName));
        nodes[self.id][key] = value;
        self.localStorage.setItem(this.binName, JSON.stringify(nodes));
        lockFile.unlockSync(this.binName);
    });
}

LocalRegistry.prototype.removeAttribute = function(key) {
    if (this.binName !== undefined) {
        this._removeAttributeWithRetry(key, 1, this);
    }
}

LocalRegistry.prototype._removeAttributeWithRetry = function(key, attemptNumber, self) {
    lockFile.lock(this.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._removeAttributeWithRetry, self._getWaitTime(attemptNumber), key, attemptNumber + 1, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(this.binName));
        delete nodes[self.id][key];
        self.localStorage.setItem(this.binName, JSON.stringify(nodes));
        lockFile.unlockSync(this.binName);
    });
}

/**
 * Adds a node's information to local storage
 */
LocalRegistry.prototype._addNodeToLocalStorage = function(data, attemptNumber, self, cb) {
    if (self.binName !== undefined) {
        lockFile.lock(this.binName, { stale: constants.localStorage.stale }, function (err) {
            if (err) {
                setTimeout(self._addNodeToLocalStorage, self._getWaitTime(attemptNumber), data, attemptNumber + 1, self, cb);
                return;
            }
            var nodes = JSON.parse(self.localStorage.getItem(self.binName));
            nodes[self.id] = data;
            self.localStorage.setItem(self.binName, JSON.stringify(nodes));
            lockFile.unlockSync(self.binName);
            cb();
        });
    }
}

/*
 * Helper for computing wait time
 */
LocalRegistry.prototype._getWaitTime = function(attemptNumber) {
    return Math.ceil(Math.random() * Math.pow(2, attemptNumber));
}

/**
 * Update lastCheckIn field
 */
LocalRegistry.prototype._checkIn = function(attemptNumber, self) {
    lockFile.lock(self.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._checkIn, self._getWaitTime(attemptNumber), attemptNumber + 1, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(self.binName));
        nodes[self.id].lastCheckIn = Date.now();
        self.localStorage.setItem(self.binName, JSON.stringify(nodes));
        lockFile.unlockSync(self.binName);
    });
}

/**
 * Scans local storage for newly online/offline nodes every x seconds
 */
LocalRegistry.prototype._scan = function(self) {
    var binName;
    var baseName;
    if (self.machType === constants.globals.NodeType.DEVICE) {
        baseName = 'fogs_';
    } else if (self.machType === constants.globals.NodeType.FOG){
        baseName = 'clouds_';
    }
    var nodes;
    var updates;
    var newlyOnlineNodes = [];
    var newlyOfflineNodes = [];
    for (var i = 0; i < constants.localStorage.numBins; i++) {
        binName = baseName + i;
        nodes = JSON.parse(self.localStorage.getItem(binName));
        updates = self._getUpdate(nodes, self);
        newlyOnlineNodes = newlyOnlineNodes.concat(updates.newlyOnlineMachs);
        newlyOfflineNodes = newlyOfflineNodes.concat(updates.newlyOfflineMachs);
    }
    self.lastScanAt = Date.now();
    var results = { online: newlyOnlineNodes, offline: newlyOfflineNodes };
    if (self.machType === constants.globals.NodeType.DEVICE) {
        self.emit('ls-fog-update', results);
    } else if (self.machType === constants.globals.NodeType.FOG){
        self.emit('ls-cloud-update', results);
    }
}

/**
 * Helper function for finding newly online and offline nodes
 * TODO: right now, this only gets online and offline nodes - does not factor in discoveryKeys
 */
 LocalRegistry.prototype._getUpdate = function(machs, self) {
     var newlyOnlineMachs = [];
     var newlyOfflineMachs = [];
     var now = Date.now();
     for (var machId in machs) {
         // first, check if the node has gone offline
         if ((now - machs[machId].lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
             // if we haven't already noted that the machine is offline...
             if (!self.currentOfflineMachs[machId]) {
                 newlyOfflineMachs.push(machId);
                 self.currentOfflineMachs[machId] = true;
             }
         } else if (machs[machId].updatedAt > self.lastScanAt) {
             newlyOnlineMachs.push({ id: machId, ip: machs[machId].ip, port: machs[machId].port });
             // in case we currently have this node recorded as offline
             delete self.currentOfflineMachs[machId];
         }
     }
     return { newlyOnlineMachs: newlyOnlineMachs, newlyOfflineMachs: newlyOfflineMachs };
 }

LocalRegistry.prototype._getBinName = function() {
    var binNumber = hash(this.id);
    if (this.machType === constants.globals.NodeType.FOG) {
        return 'fogs_' + binNumber;
    } else if (this.machType === constants.globals.NodeType.CLOUD) {
        return 'clouds_' + binNumber;
    } else {
        return undefined;
    }
}

/*
 * Hash a uuid into an integer in the range 0 to constants.localStorage.numBins-1
 */
function hash(uuid) {
    var hash = 0, i, chr;
    if (uuid.length === 0) return hash;
    for (i = 0; i < uuid.length; i++) {
        chr = uuid.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    if (hash < 0) {
        hash += 1;
        hash *= -1;
    }
    return hash % constants.localStorage.numBins;
}

module.exports = LocalRegistry;
