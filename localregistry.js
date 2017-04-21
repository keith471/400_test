//==============================================================================
// Registers a node locally (using local storage)
//==============================================================================

var LocalStorage = require('node-localstorage').LocalStorage,
    constants = require('./constants'),
    logger = require('./jerrlog'),
    Registry = require('./registry'),
    os = require('os');

/* create an mDNS advertisement on the local network */

function LocalRegistry(app, machType, port, id, ip) {
    this.app = app;
    this.machType = machType;
    this.port = port;
    this.id = id;
    this.ip = ip;
    // put the 'app' as a hidden directory in user's home
    this.appDir = os.homedir() + '/.' + app;
    this.localStorage = new LocalStorage(this.appDir);
    this.lastScanAt = 0;
}

/* LocalRegistry inherits from Registry */
LocalRegistry.prototype = new Registry();

/**
 * Local storage registration consists of writing yourself into local storage
 */
LocalRegistry.prototype.register = function() {
    // create an object to represent the machine
    var now = Date.now();
    var mach = {
        id: this.id,
        ip: this.ip,
        port: this.port,
        createdAt: now,
        updatedAt: now
    };

    // add it to local storage
    if (this.machType === constants.globals.NodeType.DEVICE) {
        this._addDevice(mach);
        this._scanForFogs(this);
        setInterval(this._scanForFogs, constants.localStorage.scanInterval, this);
    } else if (this.machType === constants.globals.NodeType.FOG) {
        this._addFog(mach);
        this._scanForClouds(this);
        setInterval(this._scanForClouds, constants.localStorage.scanInterval, this);
    } else {
        this._addCloud(mach);
    }
}

/**
 * Adds a device to local storage
 */
LocalRegistry.prototype._addDevice = function(mach) {
    var devs = this._getMachs('devices');
    devs.push(mach);
    this.localStorage.setItem('devices', JSON.stringify(devs));
}

/**
 * Adds a fog to local storage
 */
LocalRegistry.prototype._addFog = function(mach) {
    var fogs = this._getMachs('fogs');
    fogs.push(mach);
    this.localStorage.setItem('fogs', JSON.stringify(fogs));
}

/**
 * Adds a cloud to local storage
 */
LocalRegistry.prototype._addCloud = function(mach) {
    var clouds = this._getMachs('clouds');
    clouds.push(mach);
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
    return [];
}

/**
 * Scans local storage for new fogs every x seconds
 */
LocalRegistry.prototype._scanForFogs = function(self) {
    var fogs = JSON.parse(self.localStorage.getItem('fogs'));
    console.log('scanning...');

    var fogUpdate = self._getUpdate(fogs);

    if (fogUpdate !== null) {
        self.emit('fog-update', { newFogs: fogUpdate.newMachs, updatedFogs: fogUpdate.updatedMachs });
    }

    self.lastScanAt = Date.now();
}

/**
 * Scans local storage for new clouds every x seconds
 */
LocalRegistry.prototype._scanForClouds = function(self) {
    var clouds = JSON.parse(self.localStorage.getItem('clouds'));

    var cloudUpdate = self._getUpdate(clouds);

    if (cloudUpdate !== null) {
        self.emit('cloud-update', { newClouds: cloudUpdate.newMachs, updatedClouds: cloudUpdate.updatedMachs });
    }

    self.lastScanAt = Date.now();
}

/**
 * Helper function for finding new/updated nodes
 */
LocalRegistry.prototype._getUpdate = function(machs) {
    var newMachs = null;
    var updatedMachs = null;
    for (var i in machs) {
        if (machs[i].updatedAt > this.lastScanAt) {
            if (machs[i].createdAt === machs[i].updatedAt) {
                if (newMachs === null) {
                    newMachs = [];
                }
                newMachs.push(machs[i]);
            } else {
                if (updatedMachs === null) {
                    updatedMachs = [];
                }
                updatedMachs.push(machs[i]);
            }
        }
    }

    if (newMachs !== null || updatedMachs !== null) {
        return { newMachs: newMachs, updatedMachs: updatedMachs };
    }
    return null;
}

module.exports = LocalRegistry;
