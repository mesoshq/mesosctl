var Ajv = require("ajv"),
    os = require("os"),
    fs = require("fs"),
    path = require("path"),
    request = require("request"),
    yaml = require('js-yaml'),
    MesosDNSAgent = require("mesosdns-http-agent"),
    AsciiTable = require('ascii-table'),
    chalk = require('chalk');

var ajv = Ajv({ loadSchema: function (uri, callback) {
        request({ url: uri, json:true, method: "GET" }, function(err, res, body) {
            if (err || res.statusCode >= 400)
                callback(err || new Error('Loading error: ' + res.statusCode));
            else
                callback(null, body);
        });
    }});

function handleError (error, data) {
    console.log(chalk.red("--> " + error + (data && data.message ? data.message + (data.details && data.details[0] && data.details[0].errors && data.details[0].errors[0] ? " (Details: " + data.details[0].errors[0] +")" : "") : "")));
}

function isValidSchema (type, data, callback) {

    var allowedValidations = ["app", "group", "deployment"];

    // Check if type is allowed
    if (allowedValidations.indexOf(type) > -1) {

        // Load schema json
        var schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../", "lib/schema", "marathon_" + type + ".json")));

        ajv.compileAsync(schema, function (err, validate) {

            if (err) callback(err, null);

            var valid = validate(data);
            if (!valid) {
                if (validate.errors.length > 0) {
                    var messages = [];
                    validate.errors.forEach(function (error) {
                        messages.push(" * " + error.dataPath + " " + error.message);
                    });
                    callback("\n" + messages.join("\n"), valid);
                } else {
                    callback("The app definition has no valid schema!", valid);
                }
            } else {
                callback(null, valid);
            }

        });
        
    } else {
        callback("The schema type to check is not in the list of allowed schema type (" + allowedValidations.join(",") + ")", false);
    }
    
}

function loadJSON (filePath, schemaType, callback) {
    try {
        // If file doesn't exist this will raise an error which will be caught in the catch clause
        var stats = fs.statSync(filePath);
        var fileContents = JSON.parse(fs.readFileSync(filePath));

        // Schema check is requested, or not
        if (schemaType) {

            isValidSchema(schemaType, fileContents, function (error, isValid) {
                if (error) {
                    callback(error, null);
                } else {
                    if (isValid) {
                        callback(null, fileContents);
                    } else {
                        callback("The provided file doesn't adhere to the Marathon '" + schemaType + "' JSON schema!", null);
                    }
                }
            });

        } else {
            callback(null, fileContents);
        }
    } catch (e) {
        callback("File not found!", null);
    }
}

function callMarathon (subCommand, actionObj, dnsServers, args, cb) {

    var marathonBaseUrl = "http://leader.mesos:8080",
        urlReplaced = false;

    // Store subCommand in args
    args.subCommand = subCommand;

    var replacements = {
        "$APP_ID": "appId",
        "$DEPLOYMENT_ID": "deploymentId",
        "$GROUP_ID": "groupId"
    };

    var options = {
        agentClass: MesosDNSAgent,
        agentOptions: {
            "dnsServers": dnsServers,
            "mesosTLD": ".mesos"
        },
        method: actionObj.method,
        json: true
    };

    // Check for replacements in the URI
    Object.getOwnPropertyNames(replacements).forEach(function (replacement) {
        if (actionObj.endpoint.indexOf(replacement) > -1 && args.hasOwnProperty(replacements[replacement])) {
            options.url = marathonBaseUrl + actionObj.endpoint.replace(replacement, args[replacements[replacement]]);
            urlReplaced = true;
        }
    });

    if (!urlReplaced) {
        options.url = marathonBaseUrl + actionObj.endpoint;
    }

    // Executes the custom function if present
    if (actionObj.custom) {

        actionObj.custom(args, function (error, body) {

            if (error) {
                actionObj.action("There was a problem: " + error, body, args, cb);
            } else {

                options.body = body;

                request(options, function(error, response, body) {
                    if (error || !response) {
                        actionObj.action(error, null, args, cb);
                    }
                    if (response.statusCode < 400 && !error) {
                        actionObj.action(null, body, args, cb);
                    } else {
                        actionObj.action("There was a problem in the execution of this command: ", body, args, cb);
                    }
                });

            }

        })

    } else {

        request(options, function(error, response, body) {
            if (error || !response) {
                actionObj.action(error, null, args, cb);
            }
            if (response.statusCode < 400 && !error) {
                actionObj.action(null, body, args, cb);
            } else {
                actionObj.action("There was a problem in the execution of this command: ", body, args, cb);
            }
        });

    }

}

var opsMap = {
    "info": {
        "commands": {
            "list": {
                "endpoint": "/v2/info",
                "method": "GET",
                "description": "Shows information about the running Marathon instance",
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("Current Marathon configuration:");
                        console.log("-------------------------------");
                        console.log(yaml.safeDump(data));
                    }

                    callback();

                }
            }
        }
    },
    "app": {
        "commands": {
            "list": {
                "endpoint": "/v2/apps",
                "method": "GET",
                "description": "Lists all running apps",
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data.apps && data.apps.length > 0) {

                            var table = new AsciiTable();
                            table.setHeading("App Name", "Instances", "CPUs", "Memory", "Disk");

                            data.apps.forEach(function (app) {
                                table.addRow(app.id, app.instances, app.cpus, app.mem, app.disk);
                            });

                            console.log(table.toString());

                        } else {
                            console.log("There are currently no apps.");
                        }
                    }

                    callback();
                }
            },
            "remove": {
                "endpoint": "/v2/apps/$APP_ID",
                "method": "DELETE",
                "description": "Removes a specific app (i.e. stops the app)",
                "required": ["appId"],
                "optional": ["--force"],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The application was removed successfully!");
                    }

                    callback();
                }
            },
            "restart": {
                "endpoint": "/v2/apps/$APP_ID/restart",
                "method": "POST",
                "description": "Restarts a specific app",
                "required": ["appId"],
                "optional": ["--force"],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The application was restarted successfully!");
                    }

                    callback();
                }
            },
            "show": {
                "endpoint": "/v2/apps/$APP_ID",
                "method": "GET",
                "description": "Show the configuration details of a specific app",
                "required": ["appId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("Current configuration of app " + args.appId + ":" + os.EOL + os.EOL);
                        console.log(yaml.safeDump(data));
                    }

                    callback();
                }
            },
            "start": {
                "endpoint": "/v2/apps",
                "method": "POST",
                "description": "Starts an app with a specific configuration",
                "required": ["pathToJSON"],
                "optional": ["--force"],
                "custom": function (args, callback) {
                    // Check if "pathToJSON" is present
                    if (args["pathToJSON"]) {

                        // Load and check JSON resource
                        loadJSON(args["pathToJSON"], args.subCommand, function(error, fileContents) {

                            if (error) {

                                callback(error, null);

                            } else {

                                callback(null, fileContents);

                            }

                        });

                    } else {

                        callback("The required paramenter 'pathToJSON' was not supllied!", null);

                    }
                },
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The application was started successfully!");
                    }
                    
                    callback();
                }
            },
            "update": {
                "endpoint": "/v2/apps/$APP_ID",
                "method": "PUT",
                "description": "Updates a running specific app",
                "required": ["appId"],
                "optional": ["--force"],
                "variadic": ["properties"],
                "custom": function (args, callback) {

                    var configurationObj = {
                        "appId": args.appId
                    };

                    // Parse properties
                    if (args.properties && args.properties.length > 0) {
                        args.properties.forEach(function (property) {
                            if (property.indexOf("=") > -1) {
                                var temp = property.split("=");
                                var value = null,
                                    tempValue = temp[1].replace(/'/g , "");

                                if (tempValue.match(/^[0-9.]+$/g).length > 0) {
                                    if (tempValue.indexOf(".") > -1) {
                                        value = parseFloat(tempValue);
                                    } else {
                                        value = parseInt(tempValue);
                                    }
                                } else {
                                    value = tempValue;
                                }
                                configurationObj[temp[0]] = value;
                            }
                        });
                    }

                    callback(null, configurationObj);

                },
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The application was updated successfully!");
                    }

                    callback();
                }
            },
            "version list": {
                "endpoint": "/v2/apps/$APP_ID/versions",
                "method": "GET",
                "description": "Display the version list for a specific app",
                "required": ["appId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data.versions && data.versions.length > 0) {

                            var table = new AsciiTable();
                            table.setHeading("Versions");

                            data.versions.forEach(function (version) {
                                table.addRow(version);
                            });

                            console.log(table.toString());

                        } else {
                            console.log("There are currently no versions for this app.");
                        }
                    }

                    callback();
                }
            },
            "scale": {
                "endpoint": "/v2/apps/$APP_ID",
                "method": "PUT",
                "description": "Scales (up od down) a specific app",
                "required": ["appId", "instances"],
                "optional": [],
                "custom": function (args, callback) {
                    callback(null, {
                        "appId": args.appId,
                        "instances": args.instances
                    });
                },
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The application was scaled successfully!");
                    }

                    callback();
                }
            }
        }

    },
    "deployment": {
        "commands": {
            "list": {
                "endpoint": "/v2/deployments",
                "method": "GET",
                "description": "Lists all current deployments",
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data && data.length > 0) {

                            var table = new AsciiTable();
                            table.setHeading("Deployment ID", "Affected Apps", "Version", "Current step", "Total steps");

                            data.forEach(function (deployment) {
                                table.addRow(deployment.id, deployment.affectedApps.join("\n"), deployment.version, deployment.currentStep, deployment.totalSteps);
                            });

                            console.log(table.toString());

                        } else {
                            console.log("There are currently no deployments.");
                        }
                    }

                    callback();
                }
            },
            "rollback": {
                "endpoint": "/v2/deployments/$DEPLOYMENT_ID?force=false",
                "method": "DELETE",
                "description": "Triggers a rollback of a specific deployment",
                "required": ["deploymentId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The deployment was rolled back successfully.");
                    }

                    callback();
                }
            },
            "remove": {
                "endpoint": "/v2/deployments/$DEPLOYMENT_ID?force=true",
                "method": "DELETE",
                "description": "Removes/stops a specific deployment",
                "required": ["deploymentId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The deployment was removed successfully.");
                    }
                    
                    callback();
                }
            }
        }
    },
    "group": {
        "commands": {
            "add": {
                "endpoint": "/v2/groups",
                "method": "POST",
                "description": "Adds a new group",
                "required": ["pathToJSON"],
                "optional": ["--force"],
                "custom": function (args, callback) {
                    // Check if "pathToJSON" is present
                    if (args["pathToJSON"]) {

                        // Load and check JSON resource
                        loadJSON(args["pathToJSON"], args.subCommand, function(error, fileContents) {

                            if (error) {

                                callback(error, null);

                            } else {

                                callback(null, fileContents);

                            }

                        });

                    } else {

                        callback("The required paramenter 'pathToJSON' was not supllied!", null);

                    }
                },
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The group was created successfully!");
                    }

                    callback();
                }
            },
            "list": {
                "endpoint": "/v2/groups?embed=group.groups&embed=group.apps",
                "method": "GET",
                "description": "Lists all current groups",
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data.groups && data.groups.length > 0) {

                            var table = new AsciiTable();
                            table.setHeading("Group ID", "Version", "App ID", "Instances", "CPUs", "Memory", "Disk");

                            data.groups.forEach(function (group) {
                                group.apps.forEach(function (app, index) {
                                    table.addRow((index === 0 ? group.id : ""), (index === 0 ? group.version : ""), app.id, app.instances, app.cpus, app.mem, app.disk);
                                });
                            });

                            console.log(table.toString());

                        } else {
                            console.log("There are currently no tasks.");
                        }
                    }

                    callback();
                }
            },
            "scale": {
                "endpoint": "/v2/groups/$GROUP_ID",
                "method": "PUT",
                "description": "Scales (up or down) a specifc group",
                "required": ["groupId", "instances"],
                "optional": [],
                "custom": function (args, callback) {
                    callback(null, {
                        "scaleBy": args.instances
                    });
                },
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The group " + args.groupId + " was scaled successfully!");
                    }

                    callback();
                }
            },
            "show": {
                "endpoint": "/v2/groups/$GROUP_ID",
                "method": "GET",
                "description": "Show details about a specific group",
                "required": ["groupId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("Current configuration of group " + args.groupId + ":" + os.EOL + os.EOL);
                        console.log(yaml.safeDump(data));
                    }

                    callback();
                }
            },
            "remove": {
                "endpoint": "/v2/groups/$GROUP_ID",
                "method": "DELETE",
                "description": "Remove/stop a specific group",
                "required": ["groupId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        console.log("The group " + args.groupId + " was removed.");
                    }

                    callback();
                }
            }
        }
    },
    "task": {
        "commands": {
            "list": {
                "endpoint": "/v2/tasks?status=running",
                "method": "GET",
                "description": "Show all running tasks",
                "action": function(error, data, args, callback) {

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data.tasks && data.tasks.length > 0) {

                            var table = new AsciiTable();
                            table.setHeading("Task ID", "App Name", "Host", "Ports", "Started at", "Version", "Alive");

                            data.tasks.forEach(function (task) {
                                table.addRow(task.id, task.appId, task.host, task.ports.join(","), task.startedAt, task.version, (task.healthCheckResults ? (task.healthCheckResults[0].alive ? "Yes" : "No") : "Unknown"));
                            });

                            console.log(table.toString());

                        } else {
                            console.log("There are currently no tasks.");
                        }
                    }

                    callback();
                }
            },
            "show": {
                "endpoint": "/v2/tasks?status=running",
                "method": "GET",
                "description": "Show details about a specify running task",
                "required": ["taskId"],
                "optional": [],
                "action": function(error, data, args, callback) {

                    var found = false;

                    if (error) {
                        handleError(error, data);
                    } else {
                        if (data.tasks && data.tasks.length > 0) {
                            data.tasks.forEach(function (task) {
                                if (task.id === args.taskId) {
                                    console.log(yaml.safeDump(task));
                                    found = true;
                                }
                            });
                        }

                        if (!found) {
                            console.log("The task with the " + args.taskId + " couldn't be found.");
                        }
                    }

                    callback();
                }
            }
        }
    }
};

module.exports = function(vorpal, mesosCtl) {

    // Create the Marathon commands from the opsMap object
    Object.getOwnPropertyNames(opsMap).forEach(function (subCommand) {

        Object.getOwnPropertyNames(opsMap[subCommand].commands).forEach(function (action) {

            var optionalString = "",
                requiredString = "",
                variadicString = "";

            if (opsMap[subCommand].commands[action].required && opsMap[subCommand].commands[action].required.length > 0) {
                opsMap[subCommand].commands[action].required.forEach(function (requiredParameter) {
                    requiredString += " <" + requiredParameter + ">";
                });
            }

            if (opsMap[subCommand].commands[action].optional && opsMap[subCommand].commands[action].optional.length > 0) {
                opsMap[subCommand].commands[action].optional.forEach(function (optionalParameter) {
                    optionalString += " [" + optionalParameter + "]";
                });
            }

            if (opsMap[subCommand].commands[action].variadic && opsMap[subCommand].commands[action].variadic.length > 0) {
                opsMap[subCommand].commands[action].variadic.forEach(function (variadicParameter) {
                    variadicString += " [" + variadicParameter + "...]";
                });
            }

            var commandString = "marathon " + subCommand + " " + action;

            vorpal
                .command(commandString + requiredString + variadicString, opsMap[subCommand].commands[action].description)
                .action(function (args, callback) {
                    callMarathon(subCommand, opsMap[subCommand].commands[action], mesosCtl.config.agents, args, callback);
                });

            // Add autocomplete function if configured
            if (opsMap[subCommand].commands[action].hasOwnProperty("autocomplete")) {
                vorpal.find(commandString).autocomplete(opsMap[subCommand].commands[action]["autocomplete"]());
            }


        });

    });

    return vorpal;

};