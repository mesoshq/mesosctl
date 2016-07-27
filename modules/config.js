var path = require("path"),
    passwordHash = require("password-hash"),
    async = require("async");

function createConfig (mesosCtl, callback) {

    var self = this;

    mesosCtl.functions.getConfigurationParameters(function (error, config) {

        if (error) {
            self.log("An error occurred: " + JSON.stringify(error));
            self.log(error.stack);
            callback(error, null);
        } else {

            var prompts = {};

            // Create functions for async.series
            Object.getOwnPropertyNames(config.required).forEach(function (property) {

                var propertyObj = config.required[property];

                if (propertyObj.hasOwnProperty("enum")) {

                    prompts[property] = function (callback) {
                        self.prompt({
                            type: "list",
                            name: property,
                            message: propertyObj.description + ": ",
                            choices: propertyObj.enum
                        }, function (result) {
                            if (result.hasOwnProperty(property)) {
                                callback(null, result[property]);
                            } else {
                                // New
                                callback("Error with property " + property, null);
                            }
                        });
                    };

                } else {

                    prompts[property] = function (callback) {
                        self.prompt({
                            type: "input",
                            name: property,
                            message: propertyObj.description + ": "
                        }, function (result) {
                            if (result.hasOwnProperty(property)) {

                                if (propertyObj.type === "integer") {
                                    if (!isNaN(result[property])) {
                                        callback(null, parseInt(result[property]));
                                    } else {
                                        callback("Input cannot be parsed as integer!", result[property]);
                                    }
                                } else if (propertyObj.type === "array" && propertyObj.description.match(/IP/g)) {
                                    var tempArray = [];
                                    if (result[property].match(/ /g)) {
                                        tempArray = result[property].split(" ");
                                        tempArray.forEach(function (address) {
                                            if (!mesosCtl.functions.checkIfValidIP4Address(address)) {
                                                callback("The entered address '" + address + "' is invalid!", tempArray);
                                            }
                                        });
                                        callback(null, tempArray);
                                    } else if (result[property].match(/,/g)) {
                                        tempArray = result[property].split(",");
                                        tempArray.forEach(function (address) {
                                            if (!mesosCtl.functions.checkIfValidIP4Address(address)) {
                                                callback("The entered address '" + address + "' is invalid!", tempArray);
                                            }
                                        });
                                        callback(null, tempArray);
                                    } else {
                                        tempArray.push(result[property]);
                                        if (!mesosCtl.functions.checkIfValidIP4Address(result[property])) {
                                            callback("The entered address '" + result[property] + "' is invalid!", tempArray);
                                        } else {
                                            callback(null, tempArray);
                                        }
                                    }
                                } else {
                                    callback(null, result[property]);
                                }

                            } else {
                                // New
                                callback("There was an error with property" + property, null);
                            }

                        });

                    };

                }

            });

            // Run the series of prompts
            async.series(prompts, function (error, results) {
                if (error) {
                    self.log("An error occured:");
                    callback(error, null);
                } else {
                    // Validate configuration
                    mesosCtl.functions.isValidSchema("config", results, function (error, isValid) {
                        if (error) {
                            self.log("--> An error occurred: " + JSON.stringify(error));
                            callback(error, null);
                        } else {
                            if (isValid) {
                                // Set the given configuration details as current configuration
                                mesosCtl.config = results;

                                // Check if configuration contains an OS family property, if not, set it
                                if (!mesosCtl.config.hasOwnProperty("os_family")) {

                                    // Match OS family and set ENV variable for Ansible
                                    Object.getOwnPropertyNames(mesosCtl.options.os.families).forEach(function (family) {
                                        if (mesosCtl.options.os.families[family].indexOf(config.os) > -1) {
                                            mesosCtl.config.os_family = family;
                                        }
                                    });

                                }

                                var configPath = mesosCtl.functions.getLocalConfigPath(mesosCtl.config.cluster_name);

                                // Check if the configuration already exists
                                if (!mesosCtl.functions.checkIfConfigurationExists(configPath)) {
                                    // Serialize/save configuration
                                    mesosCtl.functions.serializeConfiguration();

                                    // Set hasValidConfig property to true
                                    mesosCtl.hasValidConfig = true;

                                    // Set currentConfigPath
                                    mesosCtl.currentConfigPath = configPath;

                                    self.log("--> The created configuration was saved to " + configPath);
                                    callback();
                                } else {
                                    self.log("--> The configuration already exists. Use 'config set clustername' to change the cluster name.");
                                    callback();
                                }
                            } else {
                                self.log("--> The current configuration is invalid!");
                                callback();
                            }
                        }

                    });

                }

            });

        }

    });

}

module.exports = function(vorpal, mesosCtl) {

    // Ensure that a .mesos-cli folder exists in the home directory
    mesosCtl.functions.ensureConfigStoragePath();

    vorpal
        .command('config create', 'Creates a configuration')
        .action(function(args, callback) {
            var self = this;

            // Check if there's already something configured before loading another configuration
            if (Object.getOwnPropertyNames(mesosCtl.config).length > 0) {
                self.prompt({
                    type: 'confirm',
                    name: 'overwrite',
                    default: false,
                    message: 'There is already a configuration currently loaded, discard: '
                }, function (result) {

                    // Check if configuration should be overwritten
                    if (result.overwrite) {
                        createConfig.bind(self, mesosCtl, callback);
                    } else {
                        self.log("--> The existing configuration will not be overwritten.");
                        callback();
                    }

                });

            } else {
                createConfig.bind(self, mesosCtl, callback)();
            }

        });

    vorpal
        .command('config load [pathToConfig]', 'Loads an existing configuration, either from specified path or from a selection of existing configurations')
        .action(function(args, callback) {
            var self = this;

            // Check if external path was provided
            if (args.pathToConfig) {

                // Check if there's already something configured before loading another configuration
                if (Object.getOwnPropertyNames(mesosCtl.config).length > 0) {
                    self.prompt({
                        type: 'confirm',
                        name: 'overwrite',
                        default: false,
                        message: 'There is already a configuration currently loaded, discard: '
                    }, function (result) {

                        // Check if configuration should be overwritten
                        if (result.overwrite) {

                            // Check if there's a file at the specified path
                            if (mesosCtl.functions.checkIfConfigurationExists(args.pathToConfig)) {

                                mesosCtl.functions.loadAndValidateConfiguration(args.pathToConfig, mesosCtl, callback);

                            } else {

                                self.log("An error occurerred: The provided path doesn't exist!");
                                callback();

                            }

                        } else {
                            self.log("--> The existing configuration will not be overwritten.");
                            callback();
                        }

                    });

                } else {

                    // Check if there's a file at the specified path
                    if (mesosCtl.functions.checkIfConfigurationExists(args.pathToConfig)) {

                        mesosCtl.functions.loadAndValidateConfiguration(args.pathToConfig, mesosCtl, callback);

                    } else {

                        self.log("An error occurerred: The provided path doesn't exist!");
                        callback();

                    }

                }
                
            } else { // Load from .mesosctl folder

                if (mesosCtl.functions.listConfigurations().length > 0) {

                    self.prompt({
                        type: 'list',
                        name: 'cluster_name',
                        message: 'Please select the configuration to load: ',
                        choices: mesosCtl.functions.listConfigurations()
                    }, function(result){

                        var cluster_name = result.cluster_name,
                            configurationPath = mesosCtl.options.configStoragePath + "/" + result.cluster_name + ".yml";

                        if (!mesosCtl.functions.checkIfConfigurationExists(configurationPath)) {
                            self.log("The cluster configuration doesn't exist! Please choose another cluster name, or 'config create' to create a cluster configuration!");
                        } else {
                            // Check if there's already something configured before loading another configuration
                            if (Object.getOwnPropertyNames(mesosCtl.config).length > 0) {
                                self.prompt({
                                    type: 'confirm',
                                    name: 'overwrite',
                                    default: false,
                                    message: 'There is already a configuration currently loaded, discard: '
                                }, function(result){

                                    // Check if configuration should be overwritten
                                    if (result.overwrite) {

                                        // Set configPath
                                        var configPath = mesosCtl.functions.getLocalConfigPath(cluster_name);

                                        mesosCtl.functions.loadAndValidateConfiguration(configPath, mesosCtl, callback);

                                    } else {

                                        self.log("--> The existing configuration will not be overwritten.");
                                        callback();

                                    }
                                });
                            } else {

                                // Set configPath
                                var configPath = mesosCtl.functions.getLocalConfigPath(cluster_name);

                                mesosCtl.functions.loadAndValidateConfiguration(configPath, mesosCtl, callback);

                            }
                        }

                    });

                } else {

                    self.log("--> There are no configurations to load. Please create one first.");
                    callback();

                }

            }

        });

    vorpal
        .command('config show', 'Displays the current configuration')
        .action(function(args, callback) {

            var self = this;

            mesosCtl.functions.toYAML(mesosCtl.config, function (error, result) {

                if (error) {
                    self.log("An error occurred: " + JSON.stringify(error));
                    callback();
                } else {
                    self.log(result);
                    callback();
                }

            });

        });

    vorpal
        .command('config validate', 'Validates the current configuration')
        .action(function(args, callback) {

            var self = this;

            mesosCtl.functions.isValidSchema("config", mesosCtl.config, function (error, isValid) {

                if (error) {
                    self.log("An error occurred: " + JSON.stringify(error));
                    callback();
                } else {
                    if (isValid) {
                        self.log("--> The current configuration is valid!");
                    } else {
                        self.log("--> The current configuration is invalid!");
                    }
                    callback();
                }

            });

        });

    vorpal
        .command('config get clustername', 'Gets the cluster name')
        .action(function(args, callback) {
            this.log("--> The current clsuter name is: " + mesosCtl.config.cluster_name);
            callback();
        });

    vorpal
        .command('config set clustername <clusterName>', 'Defines the cluster name')
        .action(function(args, callback) {
            mesosCtl.config.cluster_name = args.clusterName;
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully set the cluster name to " + args.clusterName);
            callback();
        });

    vorpal
        .command('config set os', 'Defines the OS type')
        .action(function(args, callback) {
            var self = this;
            this.prompt({
                type: 'list',
                name: 'os',
                message: 'Please select from the list of supported OS:',
                choices: mesosCtl.options.os.allowed,
                default: mesosCtl.options.os.allowed.indexOf(mesosCtl.config.os)
            }, function(result){

                // Set OS
                mesosCtl.config.os = result.os;

                // Match OS family and set ENV variable for Ansible
                Object.getOwnPropertyNames(mesosCtl.options.os.families).forEach(function(family) {
                   if (mesosCtl.options.os.families[family].indexOf(result.os) > -1) {
                       mesosCtl.config.os_family = family;
                       process.env.MESOS_CTL_OS_FAMILY = family;
                       self.log("--> Successfully set OS to " + result.os + " and OS family to " + family);
                       // Persist
                       mesosCtl.functions.serializeConfiguration();
                       callback();
                   }
                });

                callback();

            });
        });

    vorpal
        .command('config get os', 'Gets the OS type')
        .action(function(args, callback) {
            this.log("--> The currently selected OS is: " + mesosCtl.config.os);
            callback();
        });

    vorpal
        .command('config set ssh.keypath <path>', 'Defines the path to the SSH key for accessing the hosts')
        .action(function(args, callback) {
            mesosCtl.config.ssh_key_path = args.path;
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully set SSH key path to " + args.path);
            callback();
        });

    vorpal
        .command('config get ssh.keypath', 'Gets the path to the SSH key for accessing the hosts')
        .action(function(args, callback) {
            this.log("--> The path to the SSH key for accessing the hosts is: " + mesosCtl.config.ssh_key_path);
            callback();
        });

    vorpal
        .command('config set ssh.user <userName>', 'Defines the user name for the SSH key for accessing the hosts')
        .action(function(args, callback) {
            mesosCtl.config.ssh_user = args.userName;
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully set SSH user name to " + args.userName);
            callback();
        });

    vorpal
        .command('config get ssh.user', 'Gets the user name for the SSH key for accessing the hosts')
        .action(function(args, callback) {
            this.log("--> The user name for the SSH key for accessing the hosts is: " + mesosCtl.config.ssh_user);
            callback();
        });

    vorpal
        .command('config set ssh.port <port>', 'Defines the port for the SSH connection for accessing the hosts')
        .action(function(args, callback) {
            mesosCtl.config.ssh_port = args.port;
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully set SSH connection port name to " + args.port);
            callback();
        });

    vorpal
        .command('config get ssh.port', 'Gets the port for the SSH connection for accessing the hosts')
        .action(function(args, callback) {
            this.log("--> The port for the SSH connection for accessing the hosts is: " + mesosCtl.config.ssh_port);
            callback();
        });

    vorpal
        .command('config set admin.user <userName>', 'Defines the admin user name')
        .action(function(args, callback) {
            mesosCtl.config.admin_user = args.userName;
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully set admin user name to " + args.userName);
            callback();
        });

    vorpal
        .command('config get admin.user', 'Gets the admin user name')
        .action(function(args, callback) {
            this.log("--> The admin user name is: " + mesosCtl.config.admin_user);
            callback();
        });

    vorpal
        .command('config set admin.password <password>', 'Defines the admin password')
        .action(function(args, callback) {
            mesosCtl.config.admin_password_hash = passwordHash.generate(args.password);
            // Persist
            mesosCtl.functions.serializeConfiguration();
            this.log("--> Successfully hashed the admin password.");
            callback();
        });

    vorpal
        .command('config set dns.servers [dnsServer...]', 'Defines the DNS nameservers')
        .action(function(args, callback) {

            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.dnsServer));

            if (addresses.length === 0) {
                this.log("No valid IP addresses entered!");
                callback();
            } else {
                mesosCtl.config.dns_servers = addresses;
                // Persist
                mesosCtl.functions.serializeConfiguration();
                this.log("--> Successfully set the DNS nameservers to " + addresses);
                callback();
            }

        });

    vorpal
        .command('config add dns.servers [dnsServer...]', 'Adds IP address(es) to the DNS nameserver list')
        .action(function(args, callback) {

            // Validate given addresses
            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.dnsServer));

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Add addresses to current list
                mesosCtl.config.dns_servers = mesosCtl.functions.uniqueConcat(mesosCtl.config.dns_servers, addresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully added the the IP address(es) " + addresses + " to the DNS nameservers list");
                callback();
            }

        });

    vorpal
        .command('config remove dns.servers [dnsServer...]', 'Remove IP address(es) from the DNS nameserver list')
        .action(function(args, callback) {

            // Validate given addresses
            var removeAddresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.dnsServer));

            if (removeAddresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Remove addresses from current list
                mesosCtl.config.dns_servers = mesosCtl.functions.removeAddresses(mesosCtl.config.dns_servers, removeAddresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully removed the the IP address(es) " + removeAddresses + " from the DNS nameservers list");
                callback();
            }

        });

    vorpal
        .command('config set masters [masterServer...]', 'Defines the Mesos Master servers')
        .action(function(args, callback) {

            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.masterServer));

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {
                mesosCtl.config.masters = addresses;
                // Persist
                mesosCtl.functions.serializeConfiguration();
                this.log("--> Successfully set the Mesos Master servers to " + addresses);
                callback();
            }

        });

    vorpal
        .command('config add masters [masterServer...]', 'Adds IP address(es) to the Mesos Master server list')
        .action(function(args, callback) {

            // Validate given addresses
            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.masterServer));

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Add addresses to current list
                mesosCtl.config.masters = mesosCtl.functions.uniqueConcat(mesosCtl.config.masters, addresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully added the the IP address(es) " + addresses + " to the Mesos Master servers list");
                callback();
            }

        });

    vorpal
        .command('config remove masters [masterServer...]', 'Remove IP address(es) from the Mesos Master servers list')
        .action(function(args, callback) {

            // Validate given addresses
            var removeAddresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.masterServer));

            if (removeAddresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Remove addresses from current list
                mesosCtl.config.masters = mesosCtl.functions.removeAddresses(mesosCtl.config.masters, removeAddresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully removed the the IP address(es) " + removeAddresses + " from the Mesos Master servers list");
                callback();
            }

        });

    vorpal
        .command('config set agents [agentServer...]', 'Defines the Mesos Agent servers')
        .action(function(args, callback) {

            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.agentServer));

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {
                mesosCtl.config.agents = addresses;
                // Persist
                mesosCtl.functions.serializeConfiguration();
                this.log("--> Successfully set the Mesos Agent servers to " + addresses);
                callback();
            }

        });

    vorpal
        .command('config add agents [agentServer...]', 'Adds IP address(es) to the Mesos Agent server list')
        .action(function(args, callback) {

            // Validate given addresses
            var addresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.agentServer));

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Add addresses to current list
                mesosCtl.config.agents = mesosCtl.functions.uniqueConcat(mesosCtl.config.agents, addresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully added the the IP address(es) " + addresses + " to the Mesos Agent servers list");
                callback();
            }

        });

    vorpal
        .command('config remove agents [agentServer...]', 'Remove IP address(es) from the Mesos Agent servers list')
        .action(function(args, callback) {

            // Validate given addresses
            var removeAddresses = mesosCtl.functions.getValidIPAddresses(mesosCtl.functions.getUniqueItemArray(args.agentServer));

            if (removeAddresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                // Remove addresses from current list
                mesosCtl.config.agents = mesosCtl.functions.removeAddresses(mesosCtl.config.agents, removeAddresses);

                // Persist
                mesosCtl.functions.serializeConfiguration();

                this.log("--> Successfully removed the the IP address(es) " + removeAddresses + " from the Mesos Agent servers list");
                callback();
            }

        });

    vorpal
        .command('config set registry <registryServer>', 'Defines the private Docker Registry server')
        .action(function(args, callback) {

            var registryServers = [];
            registryServers.push(args.registryServer);

            var addresses = mesosCtl.functions.getValidIPAddresses(registryServers);

            if (addresses.length === 0) {
                this.log("--> No valid IP addresses entered!");
                callback();
            } else {

                mesosCtl.config.registry = addresses;
                // Persist
                mesosCtl.functions.serializeConfiguration();
                this.log("--> Successfully set the private Docker Registry server to " + addresses);
                callback();
            }

        });

    vorpal
        .command('config get registry', 'Gets the private Docker Registry server IP address')
        .action(function(args, callback) {
            this.log("--> The private Docker Registry server IP address is: " + mesosCtl.config.registry);
            callback();
        });

    return vorpal;
    
};