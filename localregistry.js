//==============================================================================
// Registers a node locally (using local storage)
//==============================================================================

var LocalStorage = require('node-localstorage').LocalStorage,
    lockFile = require('lockFile'),
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
    this.bin = hash(this.id);
    // put the 'app' as a hidden directory in user's home
    this.appDir = os.homedir() + '/.' + app;
    this.lastScanAt = 0;
    this.currentOfflineMachs = {};
    this.discoveryKeys = [];
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

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
 * API for local storage registration/discovery
 */
/*
LocalRegistry.prototype.registerAndDiscover = function() {
    // first step in registration is initializing the local storage
    var self = this;
    this._initLocalStorage(this, function() {
        // initialization complete; begin actual registration/discovery
        self._registerAndDiscover(self);
    });
}

LocalRegistry.prototype._registerAndDiscover = function(self) {
    // create an object to represent the machine
    var now = Date.now();
    var data = {
        ip: self._getIPv4Address(),
        port: self.port,
        lastCheckIn: now,
        createdAt: now,
        updatedAt: now
    };

    if (self.machType === constants.globals.NodeType.DEVICE) {
        // scan for fogs every so often
        self._scanForFogs(self);
        setInterval(self._scanForFogs, constants.localStorage.scanInterval, self);
    } else if (self.machType === constants.globals.NodeType.FOG) {
        self._addFog(data, self, function() {
            // check in every so often to indicate that we're still here
            setInterval(self._fogCheckIn, constants.localStorage.checkInInterval, self);
        });
        // scan for clouds every so often
        self._scanForClouds(self);
        setInterval(self._scanForClouds, constants.localStorage.scanInterval, self);
    } else {
        self._addCloud(data, self, function() {
            // check in every so often to indicate that we're still here
            setInterval(self._cloudCheckIn, constants.localStorage.checkInInterval, self);
        });
    }
}
*/

/**
 * API for local storage registration
 */
LocalRegistry.prototype.register = function() {
    // initialize the local storage
    var self = this;
    this._initLocalStorage(this, function() {
        // initialization complete; begin actual registration/discovery
        self._register(self);
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

    self._addNodeToLocalStorage(data, self, function() {
        // check in every so often to indicate that we're still here
        setInterval(self._checkIn, constants.localStorage.checkInInterval, self);
    });
}

/**
 * API for local storage discovery of nodes with the given key(s)
 */
LocalRegistry.prototype.discover = function(keys) {
    if (keys.constructor === Array) {
        this.discoveryKeys = this.discoveryKeys.concat(keys);
    } else {
        this.discoveryKeys.push(keys);
    }
    if (!this.scanning) {
        if (this.localStorage !== null) {
            this._beginScanning(self);
        } else {
            var self = this;
            this.on('ls-initialized', function() {
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
        // Nothing for now
    }
    this.scanning = true;
}

LocalRegistry.prototype.stopDiscovering = function(key) {
    var index = this.discoveryKeys.indexOf(key);
    if (index !== -1) {
        this.discoveryKeys.splice(index, 1);
    }
}

LocalRegistry.prototype.addAttribute = function(key, value) {
    this._addAttribute(key, value, this);
}

LocalRegistry.prototype._addAttribute = function(key, value, self) {
    var binName = null;
    if (self.machType === constants.globals.NodeType.DEVICE) {
        // Nothing for now
    } else if (self.machType === constants.globals.NodeType.FOG) {
        binName = 'fogs_' + self.bin;
    } else {
        binName = 'clouds_' + self.bin;
    }
    if (binName !== null) {
        self._addAttributeWithRetry(key, value, binName, self);
    }
}

LocalRegistry.prototype._addAttributeWithRetry = function(key, value, binName, self) {
    lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._addAttributeWithRetry, constants.localStorage.addAttributeRetryInterval, key, value, binName, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(binName));
        nodes[self.id][key] = value;
        self.localStorage.setItem(binName, JSON.stringify(nodes));
        lockFile.unlockSync(binName);
    });
}

/**
 * Adds a node's information to local storage
 */
LocalRegistry.prototype._addNodeToLocalStorage = function(data, self, cb) {
    var binName = undefined;
    if (self.machType === constants.globals.NodeType.FOG) {
        binName = 'fogs_' + self.bin;
    } else if (self.machType === constants.globals.NodeType.CLOUD) {
        binName = 'clouds_' + self.bin;
    }
    if (binName !== undefined) {
        lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
            if (err) {
                setTimeout(self._addNodeToLocalStorage, constants.localStorage.addIdRetryInterval, data, self, cb);
                return;
            }
            var nodes = JSON.parse(self.localStorage.getItem(binName));
            nodes[self.id] = data;
            self.localStorage.setItem(binName, JSON.stringify(nodes));
            lockFile.unlockSync(binName);
            cb();
        });
    }
}

/**
 * Update lastCheckIn field
 */
LocalRegistry.prototype._checkIn = function(self) {
    var binName = undefined;
    if (self.machType === constants.globals.NodeType.FOG) {
        binName = 'fogs_' + self.bin;
    } else if (self.machType === constants.globals.NodeType.CLOUD) {
        binName = 'clouds_' + self.bin;
    }
    if (binName !== undefined) {
        lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
            if (err) {
                setTimeout(self._checkIn, constants.localStorage.checkinRetryInterval, self);
                return;
            }
            var nodes = JSON.parse(self.localStorage.getItem(binName));
            nodes[self.id].lastCheckIn = Date.now();
            self.localStorage.setItem(binName, JSON.stringify(nodes));
            lockFile.unlockSync(binName);
        });
    }
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
 */
 LocalRegistry.prototype._getUpdate = function(machs, self) {
     var newlyOnlineMachs = [];
     var newlyOfflineMachs = [];
     var now = Date.now();
     for (var machId in machs) {
         var examineMach = false;
         for (var i in self.discoveryKeys) {
             if (machs[machId].hasOwnProperty(self.discoveryKeys[i])) {
                 // this machine is relevant to us
                 examineMach = true;
                 break;
             }
         }
         if (examineMach) {
             // first, check if the node has gone offline
             if ((now - machs[machId].lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
                 // if we haven't already noted that the machine is offline...
                 if (!self.currentOfflineMachs[machId]) {
                     newlyOfflineMachs.push(machId);
                     self.currentOfflineMachs[machId] = true;
                 }
             } else if (machs[machId].updatedAt > self.lastScanAt) {
                 newlyOnlineMachs.push(machId);
                 // in case we currently have this node recorded as offline
                 delete self.currentOfflineMachs[machId];
             }
         }
     }
     return { newlyOnlineMachs: newlyOnlineMachs, newlyOfflineMachs: newlyOfflineMachs };
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
