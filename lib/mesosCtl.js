var os = require('os'),
    path = require('path'),
    yaml = require('js-yaml'),
    fs = require('fs'),
    unzip = require("unzip"),
    request = require("request"),
    MesosDNSAgent = require("mesosdns-http-agent"),
    Ajv = require("ajv");

var ajv = Ajv({ loadSchema: function (uri, callback) {
    request({ url: uri, json:true, method: "GET" }, function(err, res, body) {
        if (err || res.statusCode >= 400)
            callback(err || new Error('Loading error: ' + res.statusCode));
        else
            callback(null, body);
    });
}});

module.exports = function () {

    var mesosCtl = {
        options: {
            os: {
                allowed: ["CoreOS", "Ubuntu Xenial", "Ubuntu Vivid", "Ubuntu Trusty", "Centos 7", "Centos 6", "RedHat Enterprise Linux 7", "RedHat Enterprise Linux 6", "Debian Jessie"],
                families: {
                    "CoreOS": ["CoreOS"],
                    "Debian": ["Ubuntu Xenial", "Ubuntu Vivid", "Ubuntu Trusty", "Debian Jessie"],
                    "RedHat": ["Centos 7", "Centos 6", "RedHat Enterprise Linux 7", "RedHat Enterprise Linux 6"]
                }
            },
            configStoragePath: process.env.MESOSCTL_CONFIGURATION_BASE_PATH || os.homedir() + "/.mesosctl",
            currentFile: ".current",
            repository: {
                version: "version-2.x",
                archive: "https://github.com/mesosphere/universe/archive/%%VERSION%%.zip",
                relativePath: "/repository/universe-%%VERSION%%",
                relativeIndexPath: "/repository/universe-%%VERSION%%/repo/meta/index.json"
            },
            marathonBaseUrl: "http://leader.mesos:8080",
            masterBaseUrl: "http://leader.mesos:5050"
        },
        hasValidConfig: false,
        currentConfigPath: null,
        config: {},
        functions: {
            serializeConfiguration: function (path) {
                if (path) {
                    return mesosCtl.functions.serializeYaml(path, mesosCtl.config);
                } else {
                    return mesosCtl.functions.serializeYaml(mesosCtl.functions.getLocalConfigPath(mesosCtl.config.cluster_name), mesosCtl.config);
                }
            },
            deserializeConfiguration: function (configurationName) {
                return mesosCtl.functions.deserializeYaml(mesosCtl.functions.getLocalConfigPath(configurationName));
            },
            serializeYaml: function (filePath, data) {
                try {
                    fs.writeFileSync(filePath, yaml.safeDump(data), 'utf8');
                    return { error: null };
                } catch (e) {
                    return { error: e };
                }
            },
            deserializeYaml: function (filePath) {
                try {
                    return yaml.safeLoad(fs.readFileSync(filePath, 'utf8'));
                } catch (e) {
                    return { error: e };
                }
            },
            toYAML: function (data, callback) {
                try {
                    callback(null, yaml.safeDump(data));
                } catch (error) {
                    callback(error, null);
                }
            },
            getLocalConfigPath: function (configurationName) {
                return mesosCtl.options.configStoragePath + "/" + configurationName + ".yml"
            },
            ensureConfigStoragePath: function () {
                var stats = fs.statSync(mesosCtl.options.configStoragePath);
                if (!stats) {
                    fs.mkdirSync(mesosCtl.options.configStoragePath);
                }
            },
            checkIfConfigurationExists: function (configurationPath) {
                try {
                    var stats = fs.statSync(configurationPath);
                    return true;
                } catch (e) {
                    return false;
                }
            },
            loadAndValidateConfiguration: function (configPath, mesosCtl, callback) {

                // Assign loaded config
                var config = mesosCtl.functions.deserializeYaml(configPath);

                // Check for errors
                if (!config.hasOwnProperty("error")) {

                    // Validate provided config via according JSON schema
                    mesosCtl.functions.isValidSchema("config", config, function (error, isValid) {

                        if (error) {

                            console.log("An error occurred: " + JSON.stringify(error));
                            callback();

                        } else if (isValid) {

                            // Check if configuration contains an OS family property, if not, set it
                            if (!config.hasOwnProperty("os_family")) {

                                // Match OS family and set ENV variable for Ansible
                                Object.getOwnPropertyNames(mesosCtl.options.os.families).forEach(function (family) {
                                    if (mesosCtl.options.os.families[family].indexOf(config.os) > -1) {
                                        config.os_family = family;
                                    }
                                });

                            }

                            // Set the config
                            mesosCtl.config = config;

                            // Set hasValidConfig property to true
                            mesosCtl.hasValidConfig = true;

                            // Set currentConfigPath
                            mesosCtl.currentConfigPath = configPath;

                            console.log("--> The given configuration was successfully loaded!");

                            callback();

                        } else {

                            console.log("An error occurred: The provided configuration is not valid!");
                            callback();

                        }

                    });

                }  else {
                    self.log("An error occurred: " + config.error);
                    callback();
                }

            },
            listConfigurations: function () {
                var configurations = [];
                fs.readdirSync(mesosCtl.options.configStoragePath).forEach(function (fileName) {
                    var filePath = path.join(mesosCtl.options.configStoragePath, fileName);
                    var stat = fs.statSync(filePath);
                    if (stat.isFile() && fileName.indexOf(".yml") > -1) {
                        configurations.push(fileName.replace(".yml", ""));
                    }
                });
                return configurations;
            },
            isValidSchema: function (type, data, callback) {

                var allowedValidations = ["app", "group", "deployment", "config"];

                // Check if type is allowed
                if (allowedValidations.indexOf(type) > -1) {

                    var fileName = "";

                    if (type === "config") {
                        fileName = "mesosctl_" + type + ".json";
                    } else {
                        fileName = "marathon_" + type + ".json";
                    }

                    var schemaPath = path.join(__dirname, "schema", fileName);

                    // Load schema json
                    var schema = JSON.parse(fs.readFileSync(schemaPath));

                    ajv.compileAsync(schema, function (err, validate) {

                        if (err) callback(err, null);
                        var valid = validate(data);

                        if (!valid) {
                            callback(validate.errors, valid);
                        } else {
                            callback(null, valid);
                        }

                    });

                } else {
                    callback("The schema type to check is not in the list of allowed schema type (" + allowedValidations.join(",") + ")", false);
                }

            },
            isValidSchemaDynamic: function (schemaData, data, callback) {

                ajv.compileAsync(schemaData, function (err, validate) {

                    if (err) callback(err, null);
                    var valid = validate(data);

                    if (!valid) {
                        callback(validate.errors, valid);
                    } else {
                        callback(null, valid);
                    }

                });

            },
            getConfigurationParameters: function (callback) {
                try {
                    var configSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "schema", "mesosctl_config.json"), 'utf8'));

                    var configObj = {
                        required: {},
                        optional: {}
                    };

                    Object.getOwnPropertyNames(configSchema.properties).forEach(function (property) {
                        if (configSchema.required.indexOf(property) > -1) {
                            configObj.required[property] = configSchema.properties[property];
                        } else {
                            if (property !== "provisioned" && property !== "os_family") {
                                configObj.optional[property] = configSchema.properties[property];
                            }
                        }
                    });

                    callback(null, configObj);
                } catch (error) {
                    callback(error, null);
                }
            },
            checkIfValidIP4Address: function(address) {
                var regex = /^(?!0)(?!.*\.$)((1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/;
                return regex.test(address);
            },
            getValidIPAddresses: function(ipAddresses) {
                var addresses = [];
                // Check for valid IP addresses
                if (ipAddresses.length > 0) {
                    ipAddresses.forEach(function(address) {
                        if (mesosCtl.functions.checkIfValidIP4Address(address)) {
                            addresses.push(address);
                        }
                    });
                }
                return addresses;
            },
            getUniqueItemArray: function (inputArray) {
                var temp = [];
                inputArray.forEach(function(item) {
                    if (temp.indexOf(item) === -1) {
                        temp.push(item);
                    }
                });
                return temp;
            },
            removeItemFromArray: function (arr, item) {
                for(var i = arr.length; i--;) {
                    if(arr[i] === item) {
                        arr.splice(i, 1);
                    }
                }
                return arr;
            },
            uniqueConcat: function (inputArray, toAddArray) {
                toAddArray.forEach(function(item) {
                    // Only add address if not already present
                    if (inputArray.indexOf(item) === -1) {
                        inputArray.push(item);
                    }
                });
                return inputArray;
            },
            removeAddresses: function (inputArray, toRemoveArray) {
                // Copy of original addresses
                var originalAddresses = inputArray.slice(0);

                // Remove adresses
                toRemoveArray.forEach(function(address) {
                    originalAddresses = mesosCtl.functions.removeItemFromArray(originalAddresses, address);
                });

                return originalAddresses;
            },
            downloadRepository: function () {
                request.get(mesosCtl.options.repository.archive.replace("%%VERSION%%", mesosCtl.options.repository.version)).pipe(unzip.Extract({ path: mesosCtl.options.configStoragePath+"/repository" }));
            },
            checkRepository: function () {
                try {
                    var stats = fs.statSync(path.join(mesosCtl.options.configStoragePath, mesosCtl.options.repository.relativePath.replace("%%VERSION%%", mesosCtl.options.repository.version)));
                    return true;
                } catch (e) {
                    return false;
                }
            },
            removeRepository: function () {
                if (mesosCtl.functions.checkRepository()) {
                    // TODO: Implement secure recursive directory deletion (use rimraf)
                }
            },
            getLocalRepositoryIndex: function () {
                return JSON.parse(fs.readFileSync(path.join(mesosCtl.options.configStoragePath, mesosCtl.options.repository.relativeIndexPath.replace("%%VERSION%%", mesosCtl.options.repository.version)), 'utf8'));
            },
            getPackageFile: function (packageName, packageVersion, fileType) {
                var pathToFile = path.join(mesosCtl.options.configStoragePath, mesosCtl.options.repository.relativePath.replace("%%VERSION%%", mesosCtl.options.repository.version) + "/repo/packages/" + packageName.substring(0, 1).toUpperCase() + "/" + packageName + "/" + packageVersion.toString());
                var jsonFiles = ["command", "config", "resource", "package"];

                if (jsonFiles.indexOf(fileType.toLowerCase()) > -1) {
                    return JSON.parse(fs.readFileSync(path.join(pathToFile, "/" + fileType.toLowerCase() + ".json"), 'utf8'));
                } else if (fileType.toLowerCase() === "marathon") {
                    return fs.readFileSync(path.join(pathToFile, "/marathon.json.mustache"), 'utf8');
                }
            },
            getAgents: function () {
                return mesosCtl.config.agents || [];
            },
            getLeader: function (callback) {
                var options = {
                    agentClass: MesosDNSAgent,
                    agentOptions: {
                        "dnsServers": mesosCtl.functions.getAgents(),
                        "mesosTLD": ".mesos"
                    },
                    method: "GET",
                    json: true,
                    url: "http://leader.mesos:5050/state"
                };
                request(options, function(error, response, body) {
                    if (error || !response) {
                        callback(error, null);
                    }
                    if (response.statusCode < 400 && !error) {

                        var leaderUrl = body.leader.replace("master@", "");

                        callback(null, leaderUrl);
                    } else {
                        callback("There was a problem in the execution of this command", body);
                    }
                });
            },
            leftPad: function (str, len, char) {
                str = String(str);
                var i = -1;
                if (!char && char !== 0) char = " ";
                len = len - str.length;
                while (++i < len) {
                    str = char + str;
                }
                return str;
            },
            rightPad: function (str, len, char) {
                if (! str || ! char || str.length >= len) {
                    return str;
                }
                var max = (len - str.length)/char.length;
                for (var i = 0; i < max; i++) {
                    str += char;
                }
                return str;
            }
        }
    };

    return mesosCtl;

};