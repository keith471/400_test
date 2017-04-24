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
    // put the 'app' as a hidden directory in user's home
    this.appDir = os.homedir() + '/.' + app;
    this.localStorage = new LocalStorage(this.appDir);
    this.lastScanAt = 0;
    this.currentOfflineMachs = {};
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

/**
 * Local storage registration consists of writing yourself into local storage
 */
LocalRegistry.prototype.register = function() {
    // create an object to represent the machine
    var now = Date.now();
    var data = {
        machType: this.machType,
        ip: this._getIPv4Address(),
        port: this.port,
        lastCheckIn: now,
        createdAt: now,
        updatedAt: now
    };

    // add it to local storage
    this.localStorage.setItem(this.id, JSON.stringify(data));

    if (this.machType === constants.globals.NodeType.DEVICE) {
        // add the device's id to the list of device ids in local storage
        this._addDevice(this);
        // check in every so often to scan for fogs
        this._deviceCheckIn(this);
        setInterval(this._deviceCheckIn, constants.localStorage.checkInInterval, this);
        // devices don't accept queries from anyone and so they don't scan for them
    } else if (this.machType === constants.globals.NodeType.FOG) {
        // add the fog's id to the list of fog ids in local storage
        this._addFog(this);
        // check in every so often to indicate that we're still here and to scan for fogs
        this._fogCheckIn(this);
        setInterval(this._fogCheckIn, constants.localStorage.checkInInterval, this);
    } else {
        // add the cloud's id to the list of cloud ids in local storage
        this._addCloud(this);
        // check in every so often to indicate that we're still here
        this._cloudCheckIn(this);
        setInterval(this._cloudCheckIn, constants.localStorage.checkInInterval, this);
    }
}

/**
 * Adds a device's id to the 'devices' list in local storage
 */
LocalRegistry.prototype._addDevice = function(self) {
    lockFile.lock(constants.localStorage.deviceLockFile, function (err) {
        if (err) {
            // failed to acquire lock; try again later
            console.log('failed to acquire device lock, trying again later');
            setTimeout(self._addDevice, constants.localStorage.addIdRetryInterval, self);
            return;
        }
        console.log('successfully locked device lock');
        // we've acquired the lock, so we are free to write to devices
        var devs = self._getMachs('devices');
        devs.push(self.id);
        self.localStorage.setItem('devices', JSON.stringify(devs));
        // unlock!
        lockFile.unlock(constants.localStorage.deviceLockFile, function (err) {
            if (err) {
                console.log('error while unlocking device lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            console.log('successfully unlocked device lock');
        });
    });
}

/**
 * Adds a fog's id to the 'fogs' list in local storage
 */
LocalRegistry.prototype._addFog = function(self) {
    lockFile.lock(constants.localStorage.fogLockFile, function (err) {
        if (err) {
            console.log(err);
            console.log('failed to acquire fog lock, trying again later');
            setTimeout(self._addFog, constants.localStorage.addIdRetryInterval, self);
            return;
        }
        console.log('successfully locked fog lock');
        var fogs = self._getMachs('fogs');
        fogs.push(self.id);
        self.localStorage.setItem('fogs', JSON.stringify(fogs));
        lockFile.unlock(constants.localStorage.fogLockFile, function (err) {
            if (err) {
                console.log('error while unlocking fog lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            console.log('successfully unlocked fog lock');
        });
    });
}

/**
 * Adds a cloud's id to the 'clouds' list in local storage
 */
LocalRegistry.prototype._addCloud = function(self) {
    lockFile.lock(constants.localStorage.cloudLockFile, function (err) {
        if (err) {
            console.log('failed to acquire cloud lock, trying again later');
            setTimeout(self._addCloud, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        console.log('successfully locked cloud lock');
        var clouds = self._getMachs('clouds');
        clouds.push(self.id);
        self.localStorage.setItem('clouds', JSON.stringify(clouds));
        lockFile.unlock(constants.localStorage.cloudLockFile, function (err) {
            if (err) {
                console.log('error while unlocking cloud lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            console.log('successfully unlocked cloud lock');
        });
    });
}

/**
 * A helper for getting all machines of a certain type from local storage
 */
LocalRegistry.prototype._getMachs = function(key) {
    var machStr = this.localStorage.getItem(key);
    if (machStr !== null) {
        return JSON.parse(machStr);
    }
    return [];
}

/**
 * When a device checks in, it just scans for fogs
 */
LocalRegistry.prototype._deviceCheckIn = function(self) {
    // just scan for fogs
    self._scanForFogs(self);
}

/**
 * When a fog checks in, it updates its lastCheckIn field and scans for clouds
 */
LocalRegistry.prototype._fogCheckIn = function(self) {
    // check-in
    var fog = JSON.parse(self.localStorage.getItem(self.id));
    fog.lastCheckIn = Date.now();
    self.localStorage.setItem(self.id, JSON.stringify(fog));
    // scan for clouds
    self._scanForClouds(self);
}

/**
 * When a cloud checks in, it just updates its lastCheckIn field
 */
LocalRegistry.prototype._cloudCheckIn = function(self) {
    // just check-in
    var cloud = JSON.parse(self.localStorage.getItem(self.id));
    cloud.lastCheckIn = Date.now();
    self.localStorage.setItem(self.id, JSON.stringify(cloud));
}

/**
 * Scans local storage for new fogs every x seconds
 */
LocalRegistry.prototype._scanForFogs = function(self) {
    var fogs = JSON.parse(self.localStorage.getItem('fogs'));
    console.log(fogs);
    var updates = self._getUpdate(fogs, self);

    if (updates !== null) {
        self.emit('ls-fog-update', { newlyOnlineFogs: updates.newlyOnlineMachs, newlyOfflineFogs: updates.newlyOfflineMachs });
    }
}

/**
 * Scans local storage for new clouds every x seconds
 */
LocalRegistry.prototype._scanForClouds = function(self) {
    var clouds = JSON.parse(self.localStorage.getItem('clouds'));
    var updates = self._getUpdate(clouds, self);

    if (updates !== null) {
        self.emit('ls-cloud-update', { newlyOnlineClouds: updates.newlyOnlineMachs, newlyOfflineClouds: updates.newlyOfflineMachs });
    }
}

/**
 * Helper function for finding new/updated nodes
 */
/*
LocalRegistry.prototype._getUpdate = function(machType, self) {
    var node;
    var nodeId;
    var newlyOnlineMachs = null;
    var newlyOfflineMachs = null;
    var now = Date.now();
    var nodes = JSON.parse(self.localStorage.getItem());
    for (var i = 0; i < self.localStorage.length; i++) {
        nodeId = self.localStorage.key(i);
        node = JSON.parse(self.localStorage.getItem(nodeId));
        if (node.machType === machType) {
            if (nodeId != self.id) {
                // first, check if the node has gone offline
                if ((now - node.lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
                    // if we haven't already noted that the machine is offline...
                    if (!self.currentOfflineMachs[nodeId]) {
                        if (newlyOfflineMachs === null) {
                            newlyOfflineMachs = [];
                        }
                        newlyOfflineMachs.push(nodeId);
                        self.currentOfflineMachs[nodeId] = true;
                    }
                } else if (node.updatedAt > self.lastScanAt) {
                    if (newlyOnlineMachs === null) {
                        newlyOnlineMachs = [];
                    }
                    newlyOnlineMachs.push({
                        id: nodeId,
                        ip: node.ip,
                        port: node.port
                    });
                    // in case we currently have this node recorded as offline
                    delete self.currentOfflineMachs[nodeId];
                }
            }
        }
    }

    self.lastScanAt = Date.now();

    if (newlyOnlineMachs !== null || newlyOfflineMachs !== null) {
        return { newlyOnlineMachs: newlyOnlineMachs, newlyOfflineMachs: newlyOfflineMachs };
    }

    return null;
}
*/

/**
 * Helper function for finding newly online and offline nodes
 */
LocalRegistry.prototype._getUpdate = function(machIds, self) {
    var newlyOnlineMachs = null;
    var newlyOfflineMachs = null;
    var now = Date.now();
    var mach, machId;
    for (var i in machIds) {
        machId = machIds[i];
        mach = JSON.parse(self.localStorage.getItem(machId));
        // first, check if the node has gone offline
        if ((now - mach.lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
            // if we haven't already noted that the machine is offline...
            if (!self.currentOfflineMachs[machId]) {
                if (newlyOfflineMachs === null) {
                    newlyOfflineMachs = [];
                }
                newlyOfflineMachs.push(machId);
                self.currentOfflineMachs[machId] = true;
            }
        } else if (mach.updatedAt > self.lastScanAt) {
            if (newlyOnlineMachs === null) {
                newlyOnlineMachs = [];
            }
            newlyOnlineMachs.push({
                id: machId,
                ip: mach.ip,
                port: mach.port
            });
            // in case we currently have this node recorded as offline
            delete self.currentOfflineMachs[machId];
        }
    }

    self.lastScanAt = Date.now();

    if (newlyOnlineMachs !== null || newlyOfflineMachs !== null) {
        return { newlyOnlineMachs: newlyOnlineMachs, newlyOfflineMachs: newlyOfflineMachs };
    }
    return null;
}

/**
 * Refreshes local storage
 */
LocalRegistry.prototype.refreshLocalStorage = function(self) {
    self.localStorage = new LocalStorage(self.appDir);
}

module.exports = LocalRegistry;
