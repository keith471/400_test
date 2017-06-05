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
    this.localStorage = null;
    this.binName = this._getBinName();
    // put the 'app' as a hidden directory in user's home
    this.appDir = os.homedir() + '/.' + app;
    // the timestamp when we last scanned local storage for other nodes;
    // set to zero to catch nodes that started before this node
    this.lastScanAt = 0;
    this.currentOfflineMachs = {};
    // TODO: is there a race condition involving attrsToAdd and attrsToRemove?
    // object of attributes to add next time we check-in
    this.attrsToAdd = {};
    // list of attributes to be removed the next time we check-in
    this.attrsToRemove = [];
    // boolean to keep track of whether register and discover has already been called
    this.registerAndDiscoverCalled = false;
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

/**
 * API for local storage registration/discovery
 * This function should only ever be called once, just to avoid reinitialization of this.localStorage
 * (though I don't think reinitialization would cause any issues...)
 */
LocalRegistry.prototype.registerAndDiscover = function(options) {

    if (registerAndDiscoverCalled) {
        return;
    }
    registerAndDiscoverCalled = true;

    if (options !== undefined) {
        // parse options
        // attributes
        for (var key in options.attributes) {
            this.attributes[key] = options.attributes[key];
        }

        // discoverAttributes
        for (var key in options.discoverAttributes.device) {
            this.discoverAttributes.device[key] = options.discoverAttributes.device[key];
        }

        for (var key in options.discoverAttributes.fog) {
            this.discoverAttributes.fog[key] = options.discoverAttributes.fog[key];
        }

        for (var key in options.discoverAttributes.cloud) {
            this.discoverAttributes.cloud[key] = options.discoverAttributes.cloud[key];
        }
    }

    // initialize the local storage
    var self = this;
    this._initLocalStorage(this, function() {
        self._kickStartCheckIns(self, this.attributes);
        self._kickStartScanning(self);
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
                self.localStorage.setItem('devices_' + i, '{}');
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
LocalRegistry.prototype._kickStartCheckIns = function(self, attrs) {
    // create an object to be written to local storage
    var now = Date.now();
    var data = {
        lastCheckIn: now,
        createdAt: now
    };

    // add attrs
    for (var attr in attrs) {
        if (attrs[attr] instanceof Function) {
            data[attr] = attrs[attr]();
        } else {
            data[attr] = attrs[attr];
        }
    }

    self._addNodeToLocalStorage(self, data, 1, function() {
        // check in every so often to indicate that we're still here
        setInterval(self._checkIn, constants.localStorage.checkInInterval, self, 1);
    });
}

/**
 * Kick-start scanning
 */
LocalRegistry.prototype._kickStartScanning = function(self) {
    self._scan(self);
    setInterval(self._scan, constants.localStorage.scanInterval, self);
}

/**
 * Adds a node's information to local storage
 */
LocalRegistry.prototype._addNodeToLocalStorage = function(self, data, attemptNumber, cb) {
    if (self.binName !== undefined) {
        lockFile.lock(self.binName, { stale: constants.localStorage.stale }, function (err) {
            if (err) {
                setTimeout(self._addNodeToLocalStorage, self._getWaitTime(attemptNumber), self, data, attemptNumber + 1, cb);
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

/**
 * Update lastCheckIn field
 * Also, at this time, we update the attributes of the node
 */
LocalRegistry.prototype._checkIn = function(self, attemptNumber) {
    lockFile.lock(self.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._checkIn, self._getWaitTime(attemptNumber), self, attemptNumber + 1);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(self.binName));
        // update lastCheckIn field
        nodes[self.id].lastCheckIn = Date.now();
        // update attributes
        // remove any that need removing
        for (var i = 0; i < self.attrsToRemove.length; i++) {
            delete nodes[self.id][self.attrsToRemove[i]];
        }
        // reset attrsToRemove
        self.attrsToRemove = [];
        // add any that need adding
        for (var attr in self.attrsToAdd) {
            if (self.attrsToAdd[attr] instanceof Function) {
                nodes[self.id][attr] = self.attrsToAdd[attr]();
            } else {
                nodes[self.id][attr] = self.attrsToAdd[attr];
            }
        }
        // reset attrsToAdd
        self.attrsToAdd = {};
        self.localStorage.setItem(self.binName, JSON.stringify(nodes));
        lockFile.unlockSync(self.binName);
    });
}

/**
 * Scans local storage for other nodes
 */
LocalRegistry.prototype._scan = function(self) {
    var binName;
    var baseName;
    var machs;

    if (Object.keys(self.discoverAttributes.device).length !== 0) {
        baseName = 'devices_';
        for (var i = 0; i < constants.localStorage.numBins; i++) {
            binName = baseName + i;
            machs = JSON.parse(self.localStorage.getItem(binName));
            self._makeDiscoveries(machs, self.discoverAttributes.device);
        }
    }

    if (Object.keys(self.discoverAttributes.fog).length !== 0) {
        baseName = 'fogs_';
        for (var i = 0; i < constants.localStorage.numBins; i++) {
            binName = baseName + i;
            machs = JSON.parse(self.localStorage.getItem(binName));
            self._makeDiscoveries(machs, constants.globals.NodeType.FOG);
        }
    }

    if (Object.keys(self.discoverAttributes.cloud).length !== 0) {
        baseName = 'clouds_';
        for (var i = 0; i < constants.localStorage.numBins; i++) {
            binName = baseName + i;
            machs = JSON.parse(self.localStorage.getItem(binName));
            self._makeDiscoveries(machs, constants.globals.NodeType.CLOUD);
        }
    }
}

LocalRegistry.prototype._makeDiscoveries = function(machs, dattrs) {
    // only the machs that are newly online are of interest to us, unless we are interested in node status,
    // in which case newly offline nodes are also of interest
    var now = Date.now();
    for (var machId in machs) {
        for (var attr in dattrs) {
            if (attr === 'status') {
                // check if the node has gone offline
                if ((now - machs[machId].lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
                    // if we haven't already noted that the machine is offline...
                    if (!self.currentOfflineMachs[machId]) {
                        self.currentOfflineMachs[machId] = true;
                        self.emit('discovery', 'status', dattrs[attr].offline, machId, 'offline');
                    }
                } else if (machs[machId].createdAt > self.lastScanAt) {
                    // the node is newly online (or was online before the current node went online)
                    self.emit('discovery', 'status', dattrs[attr].online, machId, machs[machId].status);
                    // in case we currently have this node recorded as offline
                    delete self.currentOfflineMachs[machId];
                }
            } else {
                if (machs[machId].createdAt > self.lastScanAt) {
                    if (machs[machId].hasOwnProperty(attr)) {
                        self.emit('discovery', attr, dattrs[attr], machId, machs[machId][attr]);
                    }
                }
            }
        }
    }
}

//==============================================================================
// Add and discover attributes
//==============================================================================

/**
 * Add custom, discoverable attributes on the node
 */
LocalRegistry.prototype.addAttributes = function(attrs) {
    for (var key in attrs) {
        this.attributes[key] = attrs[key];
        this.attrsToAdd[key] = attrs[key];
    }
    //this._addAttributesWithRetry(attrs, 1, this);
}

/*
LocalRegistry.prototype._addAttributesWithRetry = function(attrs, attemptNumber, self) {
    lockFile.lock(this.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._addAttributesWithRetry, self._getWaitTime(attemptNumber), attrs, attemptNumber + 1, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(self.binName));
        for (var key in attrs) {
            nodes[self.id][key] = attrs[key];
        }
        self.localStorage.setItem(self.binName, JSON.stringify(nodes));
        lockFile.unlockSync(self.binName);
    });
}
*/

/**
 * Removes attrs, a list of attribute keys, from this node
 */
LocalRegistry.prototype.removeAttributes = function(attrs) {
    this.attrsToRemove = this.attrsToRemove.concat(attrs);
    for (var i = 0; i < attrs.length; i++) {
        delete this.attributes[attrs[i]];
    }
    // this._removeAttributeWithRetry(attrs, 1, this);
}

/*
LocalRegistry.prototype._removeAttributesWithRetry = function(attrs, attemptNumber, self) {
    lockFile.lock(self.binName, { stale: constants.localStorage.stale }, function (err) {
        if (err) {
            setTimeout(self._removeAttributesWithRetry, self._getWaitTime(attemptNumber), attrs, attemptNumber + 1, self);
            return;
        }
        var nodes = JSON.parse(self.localStorage.getItem(self.binName));
        for (var i = 0; i < attrs.length; i++) {
            delete nodes[self.id][attrs[i]];
        }
        self.localStorage.setItem(self.binName, JSON.stringify(nodes));
        lockFile.unlockSync(self.binName);
    });
}
*/

/**
 * Discover other nodes with the given attributes
 * This function need only store the attributes on the node. The LocalRegistry will
 * look for other nodes with these attributes the next time it scans local storage.
 */
LocalRegistry.prototype.discoverAttributes = function(dattrs) {
    for (var key in dattrs.device) {
        this.discoverAttributes.device[key] = dattrs.device[key];
    }

    for (var key in dattrs.fog) {
        this.discoverAttributes.fog[key] = dattrs.fog[key];
    }

    for (var key in dattrs.cloud) {
        this.discoverAttributes.cloud[key] = dattrs.cloud[key];
    }
}

/**
 * Stops discovering the specified attributes
 */
LocalRegistry.prototype.stopDiscoveringAttributes = function(dattrs) {
    for (var i = 0; i < dattrs.device.length; i++) {
        delete this.discoverAttributes.device[dattrs.device[i]];
    }

    for (var i = 0; i < dattrs.fog.length; i++) {
        delete this.discoverAttributes.fog[dattrs.fog[i]];
    }

    for (var i = 0; i < dattrs.cloud.length; i++) {
        delete this.discoverAttributes.cloud[dattrs.cloud[i]];
    }
}

//==============================================================================
// Helpers
//==============================================================================

LocalRegistry.prototype._getBinName = function() {
    var binNumber = this._hash(this.id);
    if (this.machType === constants.globals.NodeType.FOG) {
        return 'fogs_' + binNumber;
    } else if (this.machType === constants.globals.NodeType.CLOUD) {
        return 'clouds_' + binNumber;
    } else {
        return 'devices_' + binNumber;
    }
}

/**
 * Hash a uuid into an integer in the range 0 to constants.localStorage.numBins-1
 */
LocalRegistry.prototype._hash = function(uuid) {
    var hash = 0, i, chr;
    if (uuid.length === 0) return hash;
    for (i = 0; i < uuid.length; i++) {
        chr = uuid.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // convert to a 32 bit integer
    }
    if (hash < 0) {
        hash += 1;
        hash *= -1;
    }
    return hash % constants.localStorage.numBins;
}

/**
 * Helper for computing wait time
 */
LocalRegistry.prototype._getWaitTime = function(attemptNumber) {
    return Math.ceil(Math.random() * Math.pow(2, attemptNumber));
}

module.exports = LocalRegistry;
