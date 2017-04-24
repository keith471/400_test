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
    this.lastScanAt = 0;
    this.currentOfflineMachs = {};
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

LocalRegistry.prototype._initLocalStorage = function(self) {
    lockFile.lock(constants.localStorage.lsInitLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            // failed to acquire lock; try again later
            //console.log('failed to acquire init lock, trying again later');
            setTimeout(self._initLocalStorage, constants.localStorage.initRetryInterval, self);
            return;
        }
        //console.log('successfully grabbed init lock');
        lockFile.lock(constants.localStorage.devicesLock, { stale: constants.localStorage.stale}, function (err) {
            if (err) {
                // failed to acquire lock. This implies that someone else has already initilaized local storage
                self.localStorage = new LocalStorage(self.appDir);
                lockFile.unlockSync(constants.localStorage.lsInitLock);
                return;
            }
            //console.log('successfully grabbed devices lock');
            lockFile.lock(constants.localStorage.fogsLock, { stale: constants.localStorage.stale}, function (err) {
                if (err) {
                    self.localStorage = new LocalStorage(self.appDir);
                    lockFile.unlockSync(constants.localStorage.devicesLock);
                    lockFile.unlockSync(constants.localStorage.lsInitLock);
                    return;
                }
                //console.log('successfully grabbed fogs lock');
                lockFile.lock(constants.localStorage.cloudsLock, { stale: constants.localStorage.stale}, function (err) {
                    if (err) {
                        self.localStorage = new LocalStorage(self.appDir);
                        lockFile.unlockSync(constants.localStorage.fogsLock);
                        lockFile.unlockSync(constants.localStorage.devicesLock);
                        lockFile.unlockSync(constants.localStorage.lsInitLock);
                        return;
                    }
                    //console.log('successfully grabbed clouds lock');
                    self.localStorage = new LocalStorage(self.appDir);
                    if (!self.localStorage.getItem('devices')) {
                        self.localStorage.setItem('devices', '{}');
                        self.localStorage.setItem('fogs', '{}');
                        self.localStorage.setItem('clouds', '{}');
                    }
                    lockFile.unlockSync(constants.localStorage.cloudsLock);
                    lockFile.unlockSync(constants.localStorage.fogsLock);
                    lockFile.unlockSync(constants.localStorage.devicesLock);
                    lockFile.unlockSync(constants.localStorage.lsInitLock);
                    self._register(self);
                });
            });
        });
    });
}

/**
 * Local storage registration consists of writing yourself into local storage
 */
LocalRegistry.prototype.register = function() {
    // first step in registration is initializing the local storage
    // when this is done, it will begin the actual registration
    this._initLocalStorage(this);
}

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
        self._addDevice(data, self);
    } else if (self.machType === constants.globals.NodeType.FOG) {
        self._addFog(data, self);
    } else {
        self._addCloud(data, self);
    }
}

/**
 * Adds a device's id to the 'devices' list in local storage
 */
LocalRegistry.prototype._addDevice = function(data, self) {
    lockFile.lock(constants.localStorage.devicesLock, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            // failed to acquire lock; try again later
            //console.log('failed to acquire device lock, trying again later');
            setTimeout(self._addDevice, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        //console.log('successfully locked device lock');
        // we've acquired the lock, so we are free to write to devices
        var devs = JSON.parse(self.localStorage.getItem('devices'));
        devs[self.id] = data;
        self.localStorage.setItem('devices', JSON.stringify(devs));
        // unlock!
        lockFile.unlock(constants.localStorage.devicesLock, function (err) {
            if (err) {
                //console.log('error while unlocking device lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked device lock');
            // check in every so often to scan for fogs
            setInterval(self._deviceCheckIn, constants.localStorage.checkInInterval, self);
        });
    });
}

/**
 * Adds a fog's id to the 'fogs' list in local storage
 */
LocalRegistry.prototype._addFog = function(data, self) {
    lockFile.lock(constants.localStorage.fogsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire fog lock, trying again later');
            setTimeout(self._addFog, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        //console.log('successfully locked fog lock');
        var fogs = JSON.parse(self.localStorage.getItem('fogs'));
        //console.log('successfully wrote fog to fogs')
        fogs[self.id] = data;
        //console.log(fogs);
        self.localStorage.setItem('fogs', JSON.stringify(fogs));
        lockFile.unlock(constants.localStorage.fogsLock, function (err) {
            if (err) {
                //console.log('error while unlocking fog lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked fog lock');
            // check in every so often to indicate that we're still here and to scan for clouds
            setInterval(self._fogCheckIn, constants.localStorage.checkInInterval, self);
        });
    });
}

/**
 * Adds a cloud's id to the 'clouds' list in local storage
 */
LocalRegistry.prototype._addCloud = function(data, self) {
    lockFile.lock(constants.localStorage.cloudsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log('failed to acquire cloud lock, trying again later');
            setTimeout(self._addCloud, constants.localStorage.addIdRetryInterval, data, self);
            return;
        }
        //console.log('successfully locked cloud lock');
        var clouds = JSON.parse(self.localStorage.getItem('clouds'));
        clouds[self.id] = data;
        self.localStorage.setItem('clouds', JSON.stringify(clouds));
        lockFile.unlock(constants.localStorage.cloudsLock, function (err) {
            if (err) {
                //console.log('error while unlocking cloud lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked cloud lock');
            // check in every so often to indicate that we're still here
            setInterval(self._cloudCheckIn, constants.localStorage.checkInInterval, self);
        });
    });
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
    lockFile.lock(constants.localStorage.fogsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire fog lock, trying again later');
            setTimeout(self._fogCheckIn, constants.localStorage.checkinRetryInterval, self);
            return;
        }
        //console.log('successfully locked fog lock');
        var fogs = JSON.parse(self.localStorage.getItem('fogs'));
        //console.log(self.id);
        fogs[self.id].lastCheckIn = Date.now();
        self.localStorage.setItem('fogs', JSON.stringify(fogs));
        lockFile.unlock(constants.localStorage.fogsLock, function (err) {
            if (err) {
                //console.log('error while unlocking fog lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked fog lock');
        });
    });
    // scan for clouds
    self._scanForClouds(self);
}

/**
 * When a cloud checks in, it just updates its lastCheckIn field
 */
LocalRegistry.prototype._cloudCheckIn = function(self) {
    // just check-in
    lockFile.lock(constants.localStorage.cloudsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire cloud lock, trying again later');
            setTimeout(self._cloudCheckIn, constants.localStorage.checkinRetryInterval, self);
            return;
        }
        //console.log('successfully locked cloud lock');
        var clouds = JSON.parse(self.localStorage.getItem('clouds'));
        clouds[self.id].lastCheckIn = Date.now();
        self.localStorage.setItem('clouds', JSON.stringify(clouds));
        lockFile.unlock(constants.localStorage.cloudsLock, function (err) {
            if (err) {
                //console.log('error while unlocking cloud lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked cloud lock');
        });
    });
}

/**
 * Scans local storage for new fogs every x seconds
 */
LocalRegistry.prototype._scanForFogs = function(self) {
    lockFile.lock(constants.localStorage.fogsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire fog lock, trying again later');
            return;
        }
        //console.log('successfully locked fog lock');
        var fogs = JSON.parse(self.localStorage.getItem('fogs'));
        var updates = self._getUpdate(fogs, self);
        if (updates !== null) {
            self.emit('ls-fog-update', { newlyOnlineFogs: updates.newlyOnlineMachs, newlyOfflineFogs: updates.newlyOfflineMachs });
        }
        lockFile.unlock(constants.localStorage.fogsLock, function (err) {
            if (err) {
                //console.log('error while unlocking fog lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked fog lock');
        });
    });
}

/**
 * Scans local storage for new clouds every x seconds
 */
LocalRegistry.prototype._scanForClouds = function(self) {
    lockFile.lock(constants.localStorage.cloudsLock, { stale: constants.localStorage.stale}, function (err) {
        if (err) {
            //console.log(err);
            //console.log('failed to acquire cloud lock, trying again later');
            return;
        }
        //console.log('successfully locked cloud lock');
        var clouds = JSON.parse(self.localStorage.getItem('clouds'));
        var updates = self._getUpdate(clouds, self);
        if (updates !== null) {
            self.emit('ls-cloud-update', { newlyOnlineClouds: updates.newlyOnlineMachs, newlyOfflineClouds: updates.newlyOfflineMachs });
        }
        lockFile.unlock(constants.localStorage.cloudsLock, function (err) {
            if (err) {
                //console.log('error while unlocking cloud lock');
                // TODO an error while unlocking the lockfile could mean that no one else can grab the lock...
                logger.log.error(err);
                return;
            }
            //console.log('successfully unlocked cloud lock');
        });
    });
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
 LocalRegistry.prototype._getUpdate = function(machs, self) {
     var newlyOnlineMachs = null;
     var newlyOfflineMachs = null;
     var now = Date.now();
     for (var machId in machs) {
         // first, check if the node has gone offline
         if ((now - machs[machId].lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
             // if we haven't already noted that the machine is offline...
             if (!self.currentOfflineMachs[machId]) {
                 if (newlyOfflineMachs === null) {
                     newlyOfflineMachs = [];
                 }
                 newlyOfflineMachs.push(machId);
                 self.currentOfflineMachs[machId] = true;
             }
         } else if (machs[machId].updatedAt > self.lastScanAt) {
             if (newlyOnlineMachs === null) {
                 newlyOnlineMachs = [];
             }
             newlyOnlineMachs.push(machId);
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
