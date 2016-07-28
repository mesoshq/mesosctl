var request = require("request"),
    MesosDNSAgent = require("mesosdns-http-agent"),
    Mustache = require("mustache"),
    chalk = require('chalk');

// Overwrite Mustache.js HTML escaping
Mustache.escape = function (value) {
    return value;
};

function getDefaultConfiguration (config) {

    var defaultConfigProperties = {};

    Object.getOwnPropertyNames(config.properties).forEach(function (propertyType) {

        // Iterate over all properties of propertyType
        Object.getOwnPropertyNames(config.properties[propertyType].properties).forEach(function (property) {

            // Create subobject if not yet present
            if (!defaultConfigProperties[propertyType]) {
                defaultConfigProperties[propertyType] = {};
            }

            if (config.properties[propertyType].properties[property].properties) {

                Object.getOwnPropertyNames(config.properties[propertyType].properties[property].properties).forEach(function (subProperty) {

                    // Create subobject if not yet present
                    if (!defaultConfigProperties[propertyType][property]) {
                        defaultConfigProperties[propertyType][property] = {};
                    }

                    var value = config.properties[propertyType].properties[property].properties[subProperty].default;

                    // Fix the Mustache.js rendering of empty arrays upfront -> cast to string
                    if (Array.isArray(value) && value.length === 0) {
                        value = "[]";
                    }
                    defaultConfigProperties[propertyType][property][subProperty] = value;

                });

            } else {

                var value = config.properties[propertyType].properties[property].default;

                // Fix the Mustache.js rendering of empty arrays upfront -> cast to string
                if (Array.isArray(value) && value.length === 0) {
                    value = "[]";
                }

                defaultConfigProperties[propertyType][property] = value;

            }

        });

    });

    return defaultConfigProperties;

}

function installPackage (payload, mesosCtl, cb) {
    var options = {
        agentClass: MesosDNSAgent,
        agentOptions: {
            "dnsServers": mesosCtl.functions.getAgents(),
            "mesosTLD": ".mesos"
        },
        method: "POST",
        url: mesosCtl.options.marathonBaseUrl + "/v2/apps",
        json: true,
        body: payload
    };

    request(options, function(error, response, body) {
        if (error || !response) {
            cb((error || "An error occurred"), false);
        }
        if (response && response.statusCode == 201 && !error) {
            cb(null, true);
        } else {
            cb("There was a problem installing the package", false);
        }
    });

}

function doRequest (requestOptionsObj, dnsServers, callback) {

    var options = {
        agentClass: MesosDNSAgent,
        agentOptions: {
            "dnsServers": dnsServers,
            "mesosTLD": ".mesos"
        },
        json: true
    };

    Object.getOwnPropertyNames(requestOptionsObj).forEach(function (property) {
        options[property] = requestOptionsObj[property];
    });

    request(options, function(error, response, body) {
        if (error || !response) {
            callback(error, null);
        }
        if (response.statusCode < 400 && !error) {
            callback(null, body);
        } else {
            callback("There was a problem in the execution of this command: " + (error ? error : ""), body);
        }
    });

}

function handleError (error, data) {
    console.log("--> " + error + (data && data.message ? data.message + (data.details && data.details[0] && data.details[0].errors && data.details[0].errors[0] ? " (Details: " + data.details[0].errors[0] +")" : "") : ""));
}

module.exports = function(vorpal, mesosCtl) {

    // Init package index if repository is installed
    mesosCtl.functions.initPackageIndex();

    vorpal
        .command('package install <packageName>', 'Installs a package')
        .option("--config <pathToConfig>", "The absolute path to the package's configuration")
        .autocomplete(mesosCtl.packages.list)
        .action(function(args, callback) {
            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> The DC/OS Universe repository has not yet been installed locally! Please run 'repository download'.");
                callback();
            } else {

                self.prompt({
                    type: 'list',
                    name: 'packageVersion',
                    message: 'Please select a version to install: ',
                    choices: function () {
                        var versions = [];
                        Object.getOwnPropertyNames(mesosCtl.packages.map[args.packageName].versions).forEach(function (version) {
                            versions.push(version);
                        });
                        return versions;
                    }
                }, function(versionResult) {

                    // Load the config file
                    var config = mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[versionResult.packageVersion], "config");

                    // Load the package info file
                    var package = mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[versionResult.packageVersion], "package");

                    // Load the Mustache template for Marathon
                    var marathonTemplate = mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[versionResult.packageVersion], "marathon");

                    // View placeholder
                    var view = {};

                    // Check if custom config has been provided
                    if (args.options && args.options.config) {
                        // Check if provided configuration path exists
                        if (mesosCtl.functions.checkIfConfigurationExists(args.options.config)) {

                            var customConfig = JSON.parse(require("fs").readFileSync(args.options.config, "utf8").toString());

                            mesosCtl.functions.isValidSchemaDynamic(config, customConfig, function (error, isValid) {

                                if (error) {
                                    self.log("--> An error occurred: " + JSON.stringify(error));
                                    callback();
                                } else {
                                    if (isValid) {
                                        // Set custom configuration as "view"
                                        view = customConfig;

                                        // Show preInstall Notes if they exist
                                        if (package.preInstallNotes) {
                                            self.log(package.preInstallNotes);
                                        }

                                        // Add resource information to default configuration
                                        view.resource =  mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[versionResult.packageVersion], "resource");

                                        self.log(JSON.stringify(view));
                                        self.log(Mustache.render(marathonTemplate, view));

                                        // Parse Marathon app template
                                        var payload = JSON.parse(Mustache.render(marathonTemplate, view));

                                        // Run package installation
                                        installPackage(payload, mesosCtl, function (error, installationOk) {
                                            if (installationOk) {
                                                // Show postInstall Notes if they exist
                                                if (package.postInstallNotes) {
                                                    self.log(package.postInstallNotes + "\n");
                                                } else {
                                                    self.log("--> The package " + args.packageName + " was installed sucessfully!");
                                                }

                                                // Check if installedPackages property exists
                                                if (!mesosCtl.config.installedPackages) {
                                                    mesosCtl.config.installedPackages = [];
                                                }

                                                // Store package in installed packages
                                                mesosCtl.config.installedPackages.push(args.packageName);
                                            } else {
                                                self.log("--> The package " + args.packageName + " wasn't installed sucessfully!");
                                                self.log("--> " + error);
                                            }

                                            callback();

                                        });

                                    } else {
                                        self.log("--> The provided configuration is invalid!");
                                    }
                                }

                            });

                        } else {
                            self.log("--> The provided path '" + args.options.pathToConfig + "' doesn't exist!");
                            callback();
                        }
                    } else {
                        // Get default configuration
                        view = getDefaultConfiguration(config);

                        // Show preInstall Notes if they exist
                        if (package.preInstallNotes) {
                            self.log(package.preInstallNotes);
                        }

                        // Add resource information to default configuration
                        view.resource =  mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[versionResult.packageVersion], "resource");

                        // Parse Marathon app template
                        var payload = JSON.parse(Mustache.render(marathonTemplate, view));

                        // Run package installation
                        installPackage(payload, mesosCtl, function (error, installationOk) {
                            if (installationOk) {
                                // Show postInstall Notes if they exist
                                if (package.postInstallNotes) {
                                    self.log(package.postInstallNotes + "\n");
                                } else {
                                    self.log("--> The package " + args.packageName + " was installed sucessfully!");
                                }

                                // Check if installedPackages property exists
                                if (!mesosCtl.config.installedPackages) {
                                    mesosCtl.config.installedPackages = [];
                                }

                                // Store package in installed packages
                                mesosCtl.config.installedPackages.push(args.packageName);
                            } else {
                                self.log("--> The package " + args.packageName + " wasn't installed sucessfully!");
                                self.log("--> " + error);
                            }

                            callback();

                        });

                    }

                });


            }

        });

    vorpal
        .command('package describe <packageName>', 'Displays information about a package')
        .autocomplete(mesosCtl.packages.list)
        .option("--options <pathToOptions>", "Use the package installation options provides by a specific file")
        .option("--package-versions", "Show the available package versions")
        //.option("--render", "Populate the package's templates with values from package's config.json and potentially a user-supplied configuration")
        .action(function(args, callback) {

            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> The DC/OS Universe repository has not yet been installed locally! Please run 'repository install'.");
                callback();
            } else {

                if (args.options.hasOwnProperty("package-versions")) {
                    var header = "The package '" + args.packageName + "' currently has the following versions:";
                    self.log(header);
                    self.log(mesosCtl.functions.rightPad("-", header.length, "-"));
                    self.log(Object.getOwnPropertyNames(mesosCtl.packages.map[args.packageName].versions).join("\n"));
                } else if (args.options.hasOwnProperty("render")) {
                    // TODO: Implement!
                } else {
                    var header = "Package '" + args.packageName + "':";
                    self.log(chalk.green.bold(header));
                    self.log(mesosCtl.functions.rightPad("-", header.length, "-"));
                    self.log(chalk.bold(mesosCtl.functions.rightPad("Description:", 17, " ")) + mesosCtl.packages.map[args.packageName].description);
                    self.log(chalk.bold(mesosCtl.functions.rightPad("Current version:", 17, " ")) + mesosCtl.packages.map[args.packageName].currentVersion);
                    self.log(chalk.bold(mesosCtl.functions.rightPad("Tags:", 17, " ")) + mesosCtl.packages.map[args.packageName].tags.join(", "));
                }

                callback();

            }

        });

    vorpal
        .command('package uninstall <packageName>', 'Uninstalls a package')
        .autocomplete(mesosCtl.packages.list)
        .action(function(args, callback) {

            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> The DC/OS Universe repository has not yet been installed locally! Please run 'repository install'.");
                callback();
            } else if (mesosCtl.packages.list.indexOf(args.packageName) === -1) {
                self.log("--> An error occurred: The given package name '" + args.packageName + "' cannot be found in the repository. Please check whether the name is correct!");
                callback();
            } else {

                // Load the package info file
                var package = mesosCtl.functions.getPackageFile(args.packageName, mesosCtl.packages.map[args.packageName].versions[mesosCtl.packages.map[args.packageName].currentVersion], "package");

                // Determine if the package contains a framework, or is just as Marathon app
                var isFramework = (package && package.hasOwnProperty("framework") ? package["framework"] : false);

                var appRequest = {
                    url: mesosCtl.options.marathonBaseUrl + "/v2/apps/" + args.packageName,
                    method: "GET"
                };

                // Check if app exists
                doRequest(appRequest, mesosCtl.functions.getAgents(), function (error, appResponse) {
                    if (error) {
                        handleError(error, appResponse);
                        callback();
                    } else {

                        var appDeleteRequest = {
                            url: mesosCtl.options.marathonBaseUrl + "/v2/apps/" + args.packageName,
                            method: "DELETE"
                        };

                        // If it exists, delete from Marathon
                        doRequest(appDeleteRequest, mesosCtl.functions.getAgents(), function (error, appDeleteResponse) {
                            if (error) {
                                handleError(error, appDeleteResponse);
                                callback();
                            } else {

                                self.log("--> The Marathon app of package '" + args.packageName + "' was deleted!");

                                // Check if the package is a framework as well
                                if (isFramework) {

                                    var frameworkRequest = {
                                        url: mesosCtl.options.masterBaseUrl + "/frameworks",
                                        method: "GET"
                                    };

                                    // Check is framework exists
                                    doRequest(frameworkRequest, mesosCtl.functions.getAgents(), function (error, frameworkResponse) {
                                        if (error) {
                                            handleError(error, frameworkResponse);
                                            callback();
                                        } else {

                                            var frameworkId = "",
                                                found = false;

                                            // Check if package name can be found among the active frameworks
                                            frameworkResponse.frameworks.forEach(function (framework) {
                                                if (framework.name === args.packageName && framework.active) {
                                                    frameworkId = framework.id;
                                                    found = true;
                                                }
                                            });

                                            // If found, delete framework
                                            if (found) {

                                                var frameworkDeleteRequest = {
                                                    url: mesosCtl.options.masterBaseUrl + "/master/teardown",
                                                    method: "POST",
                                                    form: {
                                                        frameworkId: frameworkId
                                                    }
                                                };

                                                // Delete framework
                                                doRequest(frameworkDeleteRequest, mesosCtl.functions.getAgents(), function (error, frameworkDeleteResponse) {
                                                    if (error) {
                                                        handleError(error, frameworkDeleteResponse);
                                                        callback();
                                                    } else {
                                                        self.log("--> The framework of package '" + args.packageName + "' was deleted!");
                                                        self.log("--> The package '" + args.packageName + "' was uninstalled successfully!");
                                                        callback();
                                                    }
                                                });

                                            } else {
                                                self.log("--> The package '" + args.packageName + "' was uninstalled successfully!");
                                                callback();
                                            }

                                        }
                                    });

                                } else {
                                    self.log("--> The package '" + args.packageName + "' was uninstalled successfully!");
                                    callback();
                                }

                            }
                        });

                    }
                });

            }

        });

    vorpal
        .command('package search <searchString>', 'Searches for packages with specific string')
        .action(function(args, callback) {

            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> The DC/OS Universe repository has not yet been installed locally! Please run 'repository install'.");
                callback();
            } else {

                var searchResults = mesosCtl.packages.index.search(args.searchString);
                var searchResponse = [];
                var searchResponseIndex = 1;

                var header = "Found " + searchResults.length + " potential matches:";
                self.log(chalk.bold(header));
                self.log(mesosCtl.functions.rightPad("-", header.length, "-"));

                searchResults.forEach(function (result) {
                    searchResponse.push(chalk.green.bold(result.ref));
                    searchResponse.push(mesosCtl.packages.map[result.ref].description.replace(/\n/g, ""));
                    searchResponse.push("");
                    searchResponseIndex++;
                });

                self.log(searchResponse.join("\n"));

                callback();

            }

        });

    return vorpal;

};