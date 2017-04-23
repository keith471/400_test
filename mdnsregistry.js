//==============================================================================
// Registers a node on the local network using mDNS
//==============================================================================

var mdns = require('mdns'),
    constants = require('./constants'),
    logger = require('./jerrlog'),
    Registry = require('./registry');

function MDNSRegistry(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
}

/* MDNSRegistry inherits from Registry */
MDNSRegistry.prototype = new Registry();

/**
 * mDNS registration consists of advertisement creation followed by service browsing
 */
MDNSRegistry.prototype.register = function() {
    this._createAdvertisement(constants.mdns.retries);
    this._browse();
}

//------------------------------------------------------------------------------
// Advertisement creation
//------------------------------------------------------------------------------

/**
 * Attempts to create an mDNS advertisement up to `retries` times
 */
MDNSRegistry.prototype._createAdvertisement = function(retries) {
    // advertise a service named `app-machType`, e.g. `myApplication-DEVICE`
    this.ad = mdns.createAdvertisement(mdns.tcp(this.app + '-' + this.machType), this.port, {name: this.id}, function(err, service) {
        if (err) {
            retries--;
            this._handleError(err, retries);
        }
    });
    this.ad.start();
}

/**
 * helper function for handling advertisement errors
 */
MDNSRegistry.prototype._handleError = function(err, retries) {
    switch (err.errorCode) {
        // if the error is unknown, then the mdns daemon may currently be down,
        // so try again in 10 seconds
        case mdns.kDNSServiceErr_Unknown:
            logger.log.error('Unknown service error: ' + err);
            if (retries === 0) {
                logger.log.warning('Exhaused all advertisement retries.');
                // make sure the add is stopped
                this.ad.stop();
                this.emit('mdns-ad-error', err);
            } else {
                setTimeout(this._createAdvertisement, constants.mdns.retryInterval, retries);
            }
            break;
        default:
            logger.log.error('Unhandled service error: ' + err + '. Abandoning mDNS.');
            // make sure the add is stopped
            this.ad.stop();
            this.emit('mdns-ad-error', err);
    }
}

//------------------------------------------------------------------------------
// Service browsing
//------------------------------------------------------------------------------

/**
 * Browses for services
 */
MDNSRegistry.prototype._browse = function() {
    // the serice a node browses for depends on the type of the node
    /* create the browser */
    var browser;
    var self = this;
    if (this.machType === constants.globals.NodeType.DEVICE) {
        // devices browse for fogs
        browser = mdns.createBrowser(mdns.tcp(this.app + '-' + constants.globals.NodeType.FOG));

        browser.on('serviceUp', function(service) {
            // ignore our own services
            if (service.name == self.id) {
                return;
            }
            /* emit the id, port, and IP address of the fog to the rest of the application */
            var retVal = self._getServiceData(service);
            if (retVal === null) {
                return;
            }
            self.emit('mdns-fog-up', retVal);
        });

        browser.on('serviceDown', function(service) {
            self.emit('mdns-fog-down', service.name);
        });

    } else if (this.machType === constants.globals.NodeType.FOG) {
        // fogs browse for clouds
        browser = mdns.createBrowser(mdns.tcp(this.app + '-' + constants.globals.NodeType.CLOUD));

        browser.on('serviceUp', function(service) {
            // ignore our own services
            if (service.name == self.id) {
                return;
            }
            /* emit the id, port, and IP address of the cloud to the rest of the application */
            var retVal = self._getServiceData(service);
            if (retVal === null) {
                return;
            }
            self.emit('mdns-cloud-up', retVal);
        });

        browser.on('serviceDown', function(service) {
            self.emit('mdns-cloud-down', service.name);
        });

    }
    // NOTE: clouds don't browse for anyone
    /* start the browser */
    browser.start();
}

MDNSRegistry.prototype._getServiceData = function(service) {
    var ip = this._getIp(service.addresses);
    // possible that _getIp returns null
    if (ip === null) {
        return null;
    }
    return {
        id: service.name, // string
        port: service.port, // int
        ip: ip // string
    };
}

/**
 * Parses and returns an IPv4 address from an array of addresses
 */
MDNSRegistry.prototype._getIp = function(addresses) {
    for (var i = 0; i < addresses.length; i++) {
        var parts = addresses[i].split('.');
        if (parts.length === 4) {
            var valid = true;
            for (var j = 0; j < 4; j++) {
                var num = parseInt(parts[j]);
                if (isNaN(num) || (num < 0 || num > 255)) {
                    break;
                }
            }
            if (valid) {
                return addresses[i];
            }
        }
    }
    return null;
}

/**
 * A public helper to quit advertising
 */
MDNSRegistry.prototype.incognito = function() {
    this.ad.stop();
}

/* exports */
module.exports = MDNSRegistry;
