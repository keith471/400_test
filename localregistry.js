//==============================================================================
// Registers a node locally (using local storage)
//==============================================================================

var LocalStorage = require('node-localstorage').LocalStorage,
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
    // create an entry in local storage for other nodes to write queries into
    this.localStorage.setItem(this.id, '[]');

    // create an object to represent the machine
    var now = Date.now();
    var data = {
        lastCheckIn: now,
        createdAt: now,
        updatedAt: now
    };

    // add it to local storage
    if (this.machType === constants.globals.NodeType.DEVICE) {
        this._addDevice(data);
        // check in every so often to scan for fogs
        this._deviceCheckIn(this);
        setInterval(this._deviceCheckIn, constants.localStorage.checkInInterval, this);
        // devices don't accept queries from anyone and so they don't scan for them
    } else if (this.machType === constants.globals.NodeType.FOG) {
        this._addFog(data);
        // check in every so often to indicate that we're still here and to scan for fogs
        this._fogCheckIn(this);
        setInterval(this._fogCheckIn, constants.localStorage.checkInInterval, this);
        // also, scan for queries!
        this._respondToQueries();
        setInterval(this._respondToQueries, constants.localStorage.queryResponseInterval);
    } else {
        this._addCloud(data);
        // check in every so often to indicate that we're still here
        this._cloudCheckIn(this);
        setInterval(this._cloudCheckIn, constants.localStorage.checkInInterval, this);
        // also, scan for queries!
        this._respondToQueries();
        setInterval(this._respondToQueries, constants.localStorage.queryResponseInterval);
    }
}

/**
 * Writes a query to local storage
 * TODO I don't think this is thread-safe
 */
LocalRegistry.prototype.query = function(senderId, receiverId, cb) {
    // write the query to local storage
    var receiverQueries = JSON.parse(this.localStorage.getItem(receiverId));
    receiverQueries[senderId] = null;
    this.localStorage.setItem(receiverId, JSON.stringify(receiverQueries));

    // get the response
    this._getResponse(senderId, receiverId, cb, constants.localStorage.queryRetries);
}

/**
 * Try to get the response to a query up to retries times
 */
LocalRegistry.prototype._getResponse = function(senderId, receiverId, cb, retries) {
    var receiverQueries = JSON.parse(this.localStorage.getItem(receiverId));
    var response = receiverQueries[senderId];
    if (response !== null) {
        delete receiverQueries[senderId];
        this.localStorage.setItem(receiverId, JSON.stringify(receiverQueries));
        response.id = receiverId;
        cb(null, response);
        return;
    }

    // decrement retries
    retries--;

    if (retries === 0) {
        cb(new Error("timeout while waiting for query response"));
        return;
    }

    // try again after a bit of time
    setTimeout(this._getResponse, 100, senderId, receiverId, cb, retries);
}

/**
 * Checks local storage for queries to us and responds if need be
 * TODO I don't think this is thread-safe
 */
LocalRegistry.prototype._respondToQueries = function() {
    var queries = JSON.parse(this.localStorage.getItem(this.id));
    var connectionData = {
        port: this.port,
        ip: this.ip
    };

    for (var senderId in queries) {
        if (!queries.hasOwnProperty(senderId)) continue;
        queries[senderId] = connectionData;
    }

    this.localStorage.setItem(this.id, JSON.stringify(queries));
}

/**
 * Adds a device to local storage
 */
LocalRegistry.prototype._addDevice = function(data) {
    var devs = this._getMachs('devices');
    devs[this.id] = data;
    this.localStorage.setItem('devices', JSON.stringify(devs));
}

/**
 * Adds a fog to local storage
 */
LocalRegistry.prototype._addFog = function(data) {
    var fogs = this._getMachs('fogs');
    fogs[this.id] = data;
    this.localStorage.setItem('fogs', JSON.stringify(fogs));
}

/**
 * Adds a cloud to local storage
 */
LocalRegistry.prototype._addCloud = function(data) {
    var clouds = this._getMachs('clouds');
    clouds[this.id] = data;
    this.localStorage.setItem('clouds', JSON.stringify(clouds));
}

/**
 * A helper for getting all machines of a certain type from local storage
 */
LocalRegistry.prototype._getMachs = function(key) {
    var machStr = this.localStorage.getItem(key);
    if (machStr !== null) {
        return JSON.parse(machStr);
    }
    return {};
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
    var fogs = JSON.parse(self.localStorage.getItem('fogs'));
    fogs[self.id].lastCheckIn = Date.now();
    self.localStorage.setItem('fogs', JSON.stringify(fogs));
    // scan for clouds
    self._scanForClouds(self);
}

/**
 * When a cloud checks in, it just updates its lastCheckIn field
 */
LocalRegistry.prototype._cloudCheckIn = function(self) {
    // just check-in
    var clouds = JSON.parse(self.localStorage.getItem('clouds'));
    clouds[self.id].lastCheckIn = Date.now();
    self.localStorage.setItem('clouds', JSON.stringify(clouds));
}

/**
 * Scans local storage for new fogs every x seconds
 */
LocalRegistry.prototype._scanForFogs = function(self) {
    var fogs = JSON.parse(self.localStorage.getItem('fogs'));

    var fogUpdate = self._getUpdate(fogs);

    if (fogUpdate !== null) {
        self.emit('ls-fog-update', { newlyOnlineFogs: fogUpdate.newlyOnlineMachs, newlyOfflineFogs: fogUpdate.newlyOfflineMachs });
    }
}

/**
 * Scans local storage for new clouds every x seconds
 */
LocalRegistry.prototype._scanForClouds = function(self) {
    var clouds = JSON.parse(self.localStorage.getItem('clouds'));

    var cloudUpdate = self._getUpdate(clouds);

    if (cloudUpdate !== null) {
        self.emit('ls-cloud-update', { newlyOnlineClouds: cloudUpdate.newlyOnlineMachs, newlyOfflineClouds: cloudUpdate.newlyOfflineMachs });
    }
}

/**
 * Helper function for finding new/updated nodes
 */
LocalRegistry.prototype._getUpdate = function(machs) {
    var newlyOnlineMachs = null;
    var newlyOfflineMachs = null;
    var now = Date.now();
    for (var machId in machs) {
        // first, check if the node has gone offline
        if ((now - machs[machId].lastCheckIn) > 2 * constants.localStorage.checkInInterval) {
            // if we haven't already noted that the machine is offline...
            if (!this.currentOfflineMachs[machId]) {
                if (newlyOfflineMachs === null) {
                    newlyOfflineMachs = [];
                }
                newlyOfflineMachs.push(machId);
                this.currentOfflineMachs[machId] = true;
            }
        } else if (machs[machId].updatedAt > this.lastScanAt) {
            if (machs[machId].createdAt === machs[machId].updatedAt) {
                if (newlyOnlineMachs === null) {
                    newlyOnlineMachs = [];
                }
                newlyOnlineMachs.push(machId);
                // in case we currently have this node recorded as offline
                delete this.currentOfflineMachs[machId];
            }
        }
    }

    this.lastScanAt = Date.now();

    if (newlyOnlineMachs !== null || newlyOfflineMachs !== null) {
        return { newlyOnlineMachs: newlyOnlineMachs, newlyOfflineMachs: newlyOfflineMachs };
    }
    return null;
}

module.exports = LocalRegistry;
