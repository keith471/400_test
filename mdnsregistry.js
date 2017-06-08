//==============================================================================
// Registers a node on the local network using mDNS
//==============================================================================

var mdns = require('./mdns/lib/mdns'),
    constants = require('./constants'),
    logger = require('./jerrlog'),
    Registry = require('./registry');

function MDNSRegistry(app, machType, id, port) {
    Registry.call(this, app, machType, id, port);
    this.ads = {};
    this.browsers = {
        device: {},
        fog: {},
        cloud: {}
    };
}

/* MDNSRegistry inherits from Registry */
MDNSRegistry.prototype = Object.create(Registry.prototype);
MDNSRegistry.prototype.constructor = MDNSRegistry;

MDNSRegistry.prototype.registerAndDiscover = function(options) {
    // add any new attributes or desired discoveries to the existing ones
    if (options !== undefined) {
        // parse options
        // attributes
        this.addAttributes(options.attributes);
        // attributesToDiscover
        this.addAttributesToDiscover(options.attributesToDiscover);
    }

    this._createAdvertisements(this.attributes);
    this._browseForAttributes(this.attributesToDiscover);
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
        var txtRecord;
        if (attrs[key] instanceof Function) {
            txtRecord = {
                msg: JSON.stringify({
                    payload: attrs[key]()
                })
            };
        } else {
            txtRecord = {
                msg: JSON.stringify({
                    payload: attrs[key]
                })
            };
        }
        this._createAdvertisementWithRetries(this, key, adName, txtRecord, constants.mdns.retries);
    }
}

/**
 * Helper
 */
MDNSRegistry.prototype._createAdvertisementWithRetries = function(self, attr, adName, txtRecord, retries) {
    var ad = mdns.createAdvertisement(mdns.tcp(adName), self.port, {name: this.id, txtRecord: txtRecord}, function(err, service) {
        if (err) {
            self._handleError(self, err, ad, attr, adName, txtRecord, retries);
        } else {
            self.ads[attr] = ad;
        }
    });
    ad.start();
}

/**
 * helper function for handling advertisement errors
 */
MDNSRegistry.prototype._handleError = function(self, err, ad, attr, adName, txtRecord, retries) {
    switch (err.errorCode) {
        // if the error is unknown, then the mdns daemon may currently be down,
        // so try again in some number of seconds
        case mdns.kDNSServiceErr_Unknown:
            logger.log.error('Unknown service error: ' + err);
            if (retries === 0) {
                logger.log.warning('Exhaused all advertisement retries.');
                // make sure the ad is stopped
                ad.stop();
                self.emit('error');
            } else {
                setTimeout(self._createAdvertisementWithRetries, constants.mdns.retryInterval, self, attr, adName, txtRecord, retries - 1);
            }
            break;
        default:
            logger.log.error('Unhandled service error: ' + err + '. Abandoning mDNS.');
            // make sure the ad is stopped
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
        // ignore our own services
        if (service.name == self.id) {
            return;
        }

        // emit a discovery event!
        self.emit('discovery', attr, event, service.name, JSON.parse(service.txtRecord.msg).payload);
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
        // ignore our own services
        if (service.name == self.id) {
            return;
        }

        // emit a node online event!
        self.emit('discovery', 'status', events.online, service.name, JSON.parse(service.txtRecord.msg).payload);
    });

    browser.on('serviceDown', function(service) {
        self.emit('discovery', 'status', events.offline, service.name, 'offline');
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

MDNSRegistry.prototype.announceAttributes = function(attrs) {
    this.addAttributes(attrs);
    // TODO: could check that there isn't any crossover between attrs and this.attributes
    this._createAdvertisements(attrs);
}

MDNSRegistry.prototype.addAttributes = function(attrs) {
    for (var attr in attrs) {
        this.attributes[attr] = attrs[attr];
    }
}

MDNSRegistry.prototype.removeAttributes = function(attrs) {
    for (var i = 0; i < attrs.length; i++) {
        // remove from this.attributes
        delete this.attributes[attrs[i]];
        // stop and remove the advertisement
        this.ads[attrs[i]].stop();
        delete this.ads[attrs[i]];
    }
}

MDNSRegistry.prototype.discoverAttributes = function(dattrs) {
    this.addAttributesToDiscover(dattrs);
    // TODO: could check that there isn't any crossover between dattrs and this.attributesToDiscover
    this._browseForAttributes(dattrs);
}

MDNSRegistry.prototype.addAttributesToDiscover = function(dattrs) {
    for (var key in dattrs.device) {
        this.attributesToDiscover.device[key] = dattrs.device[key];
    }

    for (var key in dattrs.fog) {
        this.attributesToDiscover.fog[key] = dattrs.fog[key];
    }

    for (var key in dattrs.cloud) {
        this.attributesToDiscover.cloud[key] = dattrs.cloud[key];
    }
}

MDNSRegistry.prototype.stopDiscoveringAttributes = function(dattrs) {
    for (var i = 0; i < dattrs.device.length; i++) {
        // remove from this.attributesToDiscover.device
        delete this.attributesToDiscover.device[dattrs.device[i]];
        // stop and remove the browser
        this.browsers.device[dattrs.device[i]].stop();
        delete this.browsers.device[dattrs.device[i]];
    }

    for (var i = 0; i < dattrs.fog.length; i++) {
        delete this.attributesToDiscover.fog[dattrs.fog[i]];
        this.browsers.fog[dattrs.fog[i]].stop();
        delete this.browsers.fog[dattrs.fog[i]];
    }

    for (var i = 0; i < dattrs.cloud.length; i++) {
        delete this.attributesToDiscover.cloud[dattrs.cloud[i]];
        this.browsers.cloud[dattrs.cloud[i]].stop();
        delete this.browsers.cloud[dattrs.cloud[i]];
    }
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
