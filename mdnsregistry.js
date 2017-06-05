//==============================================================================
// Registers a node on the local network using mDNS
//==============================================================================

var mdns = require('./mdns/lib/mdns'),
    constants = require('./constants'),
    logger = require('./jerrlog'),
    Registry = require('./registry');

function MDNSRegistry(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.ads = {};
    this.browsers = {};
}

/* MDNSRegistry inherits from Registry */
MDNSRegistry.prototype = new Registry();

MDNSRegistry.prototype.registerAndDiscover = function(options) {
    // add any new attributes or desired discoveries to the existing ones
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

    this._createAdvertisements(this.attributes);
    this._browseForAttributes(this.discoverAttributes);
}

//------------------------------------------------------------------------------
// Advertisement creation
//------------------------------------------------------------------------------

/**
 * Creates advertisements for the provided attributes
 */
MDNSRegistry.prototype._createAdvertisements = function(attrs) {
    for (var key in attrs) {
        var adName = this.app + '-' + this.machType + '-' + key;
        var details;
        if (attrs[key] instanceof Function) {
            details = JSON.stringify({
                id: this.id,
                msg: attrs[key]()
            });
        } else {
            details = JSON.stringify({
                id: this.id,
                msg: attrs[key]
            });
        }
        this._createAdvertisementWithRetries(this, key, adName, details, constants.mdns.retries);
    }
}

/**
 * Helper
 */
MDNSRegistry.prototype._createAdvertisementWithRetries = function(self, attr, adName, details, retries) {
    var ad = mdns.createAdvertisement(mdns.tcp(adName), self.port, {name: details}, function(err, service) {
        if (err) {
            self._handleError(self, err, ad, attr, adName, details, retries);
        } else {
            self.ads[attr] = ad;
        }
    });
    ad.start();
}

/**
 * helper function for handling advertisement errors
 */
MDNSRegistry.prototype._handleError = function(self, err, ad, attr, adName, details, retries) {
    switch (err.errorCode) {
        // if the error is unknown, then the mdns daemon may currently be down,
        // so try again in some number of seconds
        case mdns.kDNSServiceErr_Unknown:
            logger.log.error('Unknown service error: ' + err);
            if (retries === 0) {
                logger.log.warning('Exhaused all advertisement retries.');
                // make sure the add is stopped
                ad.stop();
                self.emit('error');
            } else {
                setTimeout(self._createAdvertisementWithRetries, constants.mdns.retryInterval, self, attr, adName, details, retries - 1);
            }
            break;
        default:
            logger.log.error('Unhandled service error: ' + err + '. Abandoning mDNS.');
            // make sure the add is stopped
            ad.stop();
            self.emit('error');
    }
}

//------------------------------------------------------------------------------
// Service browsing
//------------------------------------------------------------------------------

/**
 * Browses for services
 */
MDNSRegistry.prototype._browseForAttributes = function(dattrs) {
    for (var attr in dattrs.device) {
        if (attr === 'status') {
            this._browseForStatus(constants.globals.NodeType.DEVICE, dattrs.device.status);
        } else {
            this._browse(attr, constants.globals.NodeType.DEVICE, dattrs.device[attr]);
        }
    }

    for (var attr in dattrs.fog) {
        if (attr === 'status') {
            this._browseForStatus(constants.globals.NodeType.FOG, dattrs.fog.status);
        } else {
            this._browse(attr, constants.globals.NodeType.FOG, dattrs.fog[attr]);
        }
    }

    for (var attr in dattrs.cloud) {
        if (attr === 'status') {
            this._browseForStatus(constants.globals.NodeType.CLOUD, dattrs.cloud.status);
        } else {
            this._browse(attr, constants.globals.NodeType.CLOUD, dattrs.cloud[attr]);
        }
    }
}

/**
 * Prep a browser to browse for any attibute except for status
 */
MDNSRegistry.prototype._browse = function(attr, machType, event) {
    var browser = mdns.createBrowser(mdns.tcp(this.app + '-' + machType + '-' + attr));

    this.browsers[machType][attr] = browser;

    var self = this;

    browser.on('serviceUp', function(service) {
        var details = JSON.parse(service.name);

        // ignore our own services
        if (details.id == self.id) {
            return;
        }

        // emit a discovery event!
        self.emit('discovery', attr, event, details.id, details.msg);
    });

    browser.start();
}

/**
 * Prep a browser to browse for the status attribute
 */
MDNSRegistry.prototype._browseForStatus = function(machType, events) {
    var browser = mdns.createBrowser(mdns.tcp(this.app + '-' + machType + '-status'));

    this.browsers[machType].status = browser;

    var self = this;

    browser.on('serviceUp', function(service) {
        var details = JSON.parse(service.name);

        // ignore our own services
        if (details.id == self.id) {
            return;
        }

        // emit a node online event!
        self.emit('discovery', 'status', events.online, details.id, details.msg);
    });

    browser.on('serviceDown', function(service) {
        var details = JSON.parse(service.name);
        self.emit('discovery', 'status', events.offline, details.id, 'offline');
    });

    browser.start();
}

/**
 * Parses and returns an IPv4 address from an array of addresses (that can be parsed from an MDNS advertisement)
 */
/*
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
*/

//==============================================================================
// Add and discover attributes
//==============================================================================

MDNSRegistry.prototype.addAttributes = function(attrs) {
    for (var attr in attrs) {
        this.attributes[attr] = attrs[attr];
    }

    // TODO: could check that there isn't any crossover between attrs and this.attributes
    this._createAdvertisements(attrs);
}

MDNSRegistry.prototype.discoverAttributes = function(dattrs) {
    // TODO: could check that there isn't any crossover between dattrs and this.discoverAttributes
    this._browseForAttributes(dattrs);
}

/**
 * mDNS cleanup
 * stops all advertising and browsing
 */
MDNSRegistry.prototype.quit = function() {
    // stop ads
    for (var attr in this.ads) {
        this.ads[attr].stop();
    }

    // stop browsers
    for (var attr in this.browsers.device) {
        this.browsers.device[attr].stop();
    }

    for (var attr in this.browsers.fog) {
        this.browsers.fog[attr].stop();
    }

    for (var attr in this.browsers.cloud) {
        this.browsers.cloud[attr].stop();
    }
}

/* exports */
module.exports = MDNSRegistry;
