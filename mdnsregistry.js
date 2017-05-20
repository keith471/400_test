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
    this.ads = {};
    this.browsers = {};
}

/* MDNSRegistry inherits from Registry */
MDNSRegistry.prototype = new Registry();

/**
 * mDNS registration consists of advertisement creation
 */
MDNSRegistry.prototype.register = function(channel) {
    this._createAdvertisement(channel, constants.mdns.retries);
}

/**
 * mDNS discovery is simply service browsing
 */
MDNSRegistry.prototype.discover = function(channel) {
    this._browse(channel);
}

/**
 * Quit browsing on the given channel
 */
MDNSRegistry.prototype.stopDiscovering = function(channel) {
    var channelName = undefined;
    if (channel === constants.globals.channels.LOCAL) {
        if (this.machType === constants.globals.NodeType.DEVICE) {
            channelName = this.app + '-' + constants.globals.NodeType.FOG + '-' + 'local';
        } else if (this.machType === constants.globals.NodeType.FOG) {
            channelName = this.app + '-' + constants.globals.NodeType.CLOUD + '-' + 'local';
        }
    } else if (channel === constants.globals.channels.DEFAULT) {
        if (this.machType === constants.globals.NodeType.DEVICE) {
            channelName = this.app + '-' + constants.globals.NodeType.FOG;
        } else if (this.machType === constants.globals.NodeType.FOG) {
            channelName = this.app + '-' + constants.globals.NodeType.CLOUD;
        }
    }
    if (channelName !== undefined && this.browsers[channelName] !== undefined) {
        this.browsers[channelName].stop();
    }
}

//------------------------------------------------------------------------------
// Advertisement creation
//------------------------------------------------------------------------------

/**
 * Attempts to create an mDNS advertisement up to `retries` times
 */
MDNSRegistry.prototype._createAdvertisement = function(channel, retries) {
    var channelName = null;
    if (channel === constants.globals.channels.DEFAULT) {
        channelName = this.app + '-' + this.machType;
    } else if (channel === constants.globals.channels.MDNS_LOCAL) {
        channelName = this.app + '-' + this.machType + '-' + 'local';
    }
    if (channelName !== null) {
        this._createAdvertisementWithName(channelName, retries, this);
    }
}

MDNSRegistry.prototype._createAdvertisementWithName = function(name, retries, self) {
    var ad = mdns.createAdvertisement(mdns.tcp(name), self.port, {name: self.id}, function(err, service) {
        if (err) {
            self._handleError(err, ad, name, retries, self);
        } else {
            console.log('created advertisement for ' + name);
            self.ads[name] = ad;
        }
    });
    ad.start();
}

/**
 * helper function for handling advertisement errors
 */
MDNSRegistry.prototype._handleError = function(err, ad, name, retries, self) {
    switch (err.errorCode) {
        // if the error is unknown, then the mdns daemon may currently be down,
        // so try again in some number of seconds
        case mdns.kDNSServiceErr_Unknown:
            logger.log.error('Unknown service error: ' + err);
            if (retries === 0) {
                logger.log.warning('Exhaused all advertisement retries.');
                // make sure the add is stopped
                ad.stop();
                self.emit('mdns-ad-error', err);
            } else {
                setTimeout(self._createAdvertisementWithName, constants.mdns.retryInterval, name, retries - 1, self);
            }
            break;
        default:
            logger.log.error('Unhandled service error: ' + err + '. Abandoning mDNS.');
            // make sure the add is stopped
            ad.stop();
            self.emit('mdns-ad-error', err);
    }
}

//------------------------------------------------------------------------------
// Service browsing
//------------------------------------------------------------------------------

/**
 * Browses for services
 */
MDNSRegistry.prototype._browse = function(channel) {
    var channelName = null;
    if (channel === constants.globals.channels.DEFAULT) {
        if (this.machType === constants.globals.NodeType.DEVICE) {
            channelName = this.app + '-' + constants.globals.NodeType.FOG;
        } else if (this.machType === constants.globals.NodeType.FOG) {
            channelName = this.app + '-' + constants.globals.NodeType.CLOUD;
        }
    } else if (channel === constants.globals.channels.MDNS_LOCAL) {
        if (this.machType === constants.globals.NodeType.DEVICE) {
            channelName = this.app + '-' + constants.globals.NodeType.FOG + '-' + 'local';
        } else if (this.machType === constants.globals.NodeType.FOG) {
            channelName = this.app + '-' + constants.globals.NodeType.CLOUD + '-' + 'local';
        }
    }
    if (channelName !== null) {
        this._browseForChannelWithName(channelName);
    }
}

MDNSRegistry.prototype._browseForChannelWithName = function(name) {
    console.log('browsing for channel with name ' + name);
    // the serice a node browses for depends on the type of the node
    /* create the browser */
    var browser = mdns.createBrowser(mdns.tcp(name));
    this.browsers[name] = browser;
    var self = this;
    if (this.machType === constants.globals.NodeType.DEVICE) {
        // devices browse for fogs
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

/* exports */
module.exports = MDNSRegistry;
