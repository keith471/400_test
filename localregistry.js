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
    this.isRegistered = false;
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
        }
        lockFile.unlockSync(constants.localStorage.initLock);
        self.emit('ls-initialized');
        cb();
    });
}

/**
 * API for local storage registration/discovery
 */
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

/**
 * API for local storage registration
 */
LocalRegistry.prototype.register = function() {
    // first step in registration is initializing the local storage
    var self = this;
    this._initLocalStorage(this, function() {
        // initialization complete; begin actual registration/discovery
        self._register(self);
    });
}

/**
 * Just the registration bits for local storage
 */
LocalRegistry.prototype._register = function(self) {
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
        // Nothing for now
    } else if (self.machType === constants.globals.NodeType.FOG) {
        self._addFog(data, self, function() {
            // check in every so often to indicate that we're still here
            setInterval(self._fogCheckIn, constants.localStorage.checkInInterval, self);
        });
    } else {
        self._addCloud(data, self, function() {
            // check in every so often to indicate that we're still here
            setInterval(self._cloudCheckIn, constants.localStorage.checkInInterval, self);
        });
    }
    self.isRegistered = true;
}

/**
 * API for local storage discovery
 */
LocalRegistry.prototype.discover = function() {
    if (this.localStorage !== null) {
        this._discover(self);
    } else {
        var self = this;
        this.on('ls-initialized', function() {
            self._discover(self);
        });
    }
}

/**
 * Just local storage discovery
 */
LocalRegistry.prototype._discover = function(self) {
    if (self.machType === constants.globals.NodeType.DEVICE) {
        // scan for fogs every so often
        self._scanForFogs(self);
        setInterval(self._scanForFogs, constants.localStorage.scanInterval, self);
    } else if (self.machType === constants.globals.NodeType.FOG) {
        // scan for clouds every so often
        self._scanForClouds(self);
        setInterval(self._scanForClouds, constants.localStorage.scanInterval, self);
    } else {
        // Nothing for now
    }
}

/**
 * Check-in
 */
/*
LocalRegistry.prototype._checkIn = function(self) {
    if (self.machType === constants.globals.NodeType.DEVICE) {
        // currently, do nothing
    } else if (self.machType === constants.globals.NodeType.FOG) {
        self._fogCheckIn(self);
    } else {
        self._cloudCheckIn(self);
    }
}
*/

/**
 * Scan
 */
/*
LocalRegistry.prototype._scan = function(self) {
    if (self.machType === constants.globals.NodeType.DEVICE) {
        self._scanForFogs(self);
    } else if (self.machType === constants.globals.NodeType.FOG) {
        self._scanForClouds(self);
    } else {
        // currently, do nothing
    }
}
*/

/**
 * Adds a fog's id to the 'fogs' list in local storage
 */
LocalRegistry.prototype._addFog = function(data, self, cb) {
    var binName = 'fogs_' + self.bin;
    lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire fog lock, trying again later');
            setTimeout(self._addFog, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        //console.log('successfully locked fog lock');
        var fogs = JSON.parse(self.localStorage.getItem(binName));
        //console.log('successfully wrote fog to fogs')
        fogs[self.id] = data;
        //console.log(fogs);
        self.localStorage.setItem(binName, JSON.stringify(fogs));
        lockFile.unlockSync(binName);
        cb();
    });
}

/**
 * Adds a cloud's id to the 'clouds' list in local storage
 */
LocalRegistry.prototype._addCloud = function(data, self, cb) {
    var binName = 'clouds_' + self.bin;
    lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            //console.log('failed to acquire cloud lock, trying again later');
            setTimeout(self._addCloud, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        //console.log('successfully locked cloud lock');
        var clouds = JSON.parse(self.localStorage.getItem(binName));
        clouds[self.id] = data;
        self.localStorage.setItem(binName, JSON.stringify(clouds));
        lockFile.unlock(binName);
        cb();
    });
}

/**
 * Update lastCheckIn field
 */
LocalRegistry.prototype._fogCheckIn = function(self) {
    var binName = 'fogs_' + self.bin;
    lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire fog lock, trying again later');
            setTimeout(self._fogCheckIn, constants.localStorage.checkinRetryInterval, self);
            return;
        }
        //console.log('successfully locked fog lock');
        var fogs = JSON.parse(self.localStorage.getItem(binName));
        //console.log(self.id);
        fogs[self.id].lastCheckIn = Date.now();
        self.localStorage.setItem(binName, JSON.stringify(fogs));
        lockFile.unlockSync(binName);
    });
}

/**
 * Update lastCheckIn field
 */
LocalRegistry.prototype._cloudCheckIn = function(self) {
    // just check-in
    var binName = 'clouds_' + self.bin;
    lockFile.lock(binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire cloud lock, trying again later');
            setTimeout(self._cloudCheckIn, constants.localStorage.checkinRetryInterval, self);
            return;
        }
        //console.log('successfully locked cloud lock');
        var clouds = JSON.parse(self.localStorage.getItem(binName));
        clouds[self.id].lastCheckIn = Date.now();
        self.localStorage.setItem(binName, JSON.stringify(clouds));
        lockFile.unlockSync(binName);
    });
}

/**
 * Scans local storage for new fogs every x seconds
 */
LocalRegistry.prototype._scanForFogs = function(self) {
    var binName;
    var fogs;
    var updates;
    var newlyOnlineFogs = [];
    var newlyOfflineFogs = [];
    for (var i = 0; i < constants.localStorage.numBins; i++) {
        binName = 'fogs_' + i;
        fogs = JSON.parse(self.localStorage.getItem(binName));
        updates = self._getUpdate(fogs, self);
        newlyOnlineFogs = newlyOnlineFogs.concat(updates.newlyOnlineMachs);
        newlyOfflineFogs = newlyOfflineFogs.concat(updates.newlyOfflineMachs);
    }
    self.lastScanAt = Date.now();
    self.emit('ls-fog-update', { newlyOnlineFogs: newlyOnlineFogs, newlyOfflineFogs: newlyOfflineFogs });
}

/**
 * Scans local storage for new clouds every x seconds
 */
LocalRegistry.prototype._scanForClouds = function(self) {
    var binName;
    var clouds;
    var updates;
    var newlyOnlineClouds = [];
    var newlyOfflineClouds = [];
    for (var i = 0; i < constants.localStorage.numBins; i++) {
        binName = 'clouds_' + i;
        clouds = JSON.parse(self.localStorage.getItem(binName));
        updates = self._getUpdate(clouds, self);
        newlyOnlineClouds = newlyOnlineClouds.concat(updates.newlyOnlineMachs);
        newlyOfflineClouds = newlyOfflineClouds.concat(updates.newlyOfflineMachs);
    }
    self.lastScanAt = Date.now();
    self.emit('ls-cloud-update', { newlyOnlineClouds: newlyOnlineClouds, newlyOfflineClouds: newlyOfflineClouds });
}

/**
 * Helper function for finding newly online and offline nodes
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
             newlyOnlineMachs.push(machId);
             // in case we currently have this node recorded as offline
             delete self.currentOfflineMachs[machId];
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
