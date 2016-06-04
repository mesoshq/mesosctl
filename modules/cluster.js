var Ansible = require('node-ansible'),
    path = require("path"),
    os = require("os"),
    MesosDNSAgent = require("mesosdns-http-agent"),
    request = require("request"),
    ProgressBar = require("progress"),
    chalk = require("chalk"),
    sshClient = require('ssh2').Client;

function extractPorts(portString) {
    portString = portString.replace("[", "").replace("]", "").toString();
    var portRanges = [];
    if (portString.indexOf(", ") > -1) {
        portRanges = portString.split(", ");
    } else {
        var p = "" + portString.toString();
        portRanges.push(String(p));
    }

    var portCount = 0;

    portRanges.forEach(function (portRange) {
        var temp = portRange.split("-");
        var start = temp[0],
            end = temp[1];
        if (start === end) {
            portCount++;
        } else {
            portCount += (end-start);
        }
    });
    return portCount;
}

function renderUtilization(utilization, header) {

    console.log(os.EOL + header + os.EOL);

    var cpuBar = new ProgressBar('  CPU    [:bar] :percent\n', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 1
    });
    cpuBar.tick(utilization.cpus);

    var memoryBar = new ProgressBar('  Memory [:bar] :percent\n', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 1
    });
    memoryBar.tick(utilization.memory);

    var diskBar = new ProgressBar('  Disk   [:bar] :percent\n', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 1
    });
    diskBar.tick(utilization.disk);

    var portsBar = new ProgressBar('  Ports  [:bar] :percent\n', {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 1
    });
    portsBar.tick(utilization.ports);

    console.log("");

}

function getUtilizationStats(dnsServers, cb) {

    var options = {
        agentClass: MesosDNSAgent,
        agentOptions: {
            "dnsServers": dnsServers,
            "mesosTLD": ".mesos"
        },
        url: "http://leader.mesos:5050/state-summary"
    };

    try {
        request(options, function(error, response, body) {
            if (error) {
                cb(error, null);
            } else {

                var response = JSON.parse(body);

                var overallResources = {
                    cpus: 0,
                    memory: 0,
                    disk: 0,
                    ports: 0
                };

                var overallUsedResources = {
                    cpus: 0,
                    memory: 0,
                    disk: 0,
                    ports: 0
                };

                var agentMap = {};

                response.slaves.forEach(function (slave) {

                    // Add to overall resources
                    overallResources.cpus += slave.resources.cpus;
                    overallResources.memory += slave.resources.mem;
                    overallResources.disk += slave.resources.disk;
                    overallResources.ports += extractPorts(slave.resources.ports);

                    // Add to used resources
                    overallUsedResources.cpus += slave.used_resources.cpus;
                    overallUsedResources.memory += slave.used_resources.mem;
                    overallUsedResources.disk += slave.used_resources.disk;
                    overallUsedResources.ports += extractPorts(slave.used_resources.ports);

                    // Add info per agent
                    agentMap[slave.hostname] = {
                        utilization: {
                            cpus: parseFloat((slave.used_resources.cpus/slave.resources.cpus).toFixed(4)),
                            memory: parseFloat((slave.used_resources.mem/slave.resources.mem).toFixed(4)),
                            disk: parseFloat((slave.used_resources.disk/slave.resources.disk).toFixed(4)),
                            ports: parseFloat((extractPorts(slave.used_resources.ports)/extractPorts(slave.resources.ports)).toFixed(4))
                        }
                    };

                });

                var utilization = {
                    cluster: {
                        utilization: {
                            cpus: parseFloat((overallUsedResources.cpus/overallResources.cpus).toFixed(4)),
                            memory: parseFloat((overallUsedResources.memory/overallResources.memory).toFixed(4)),
                            disk: parseFloat((overallUsedResources.disk/overallResources.disk).toFixed(4)),
                            ports: parseFloat((overallUsedResources.ports/overallResources.ports).toFixed(4))
                        },
                        resources: {
                            cpus: overallResources.cpus,
                            memory: overallResources.memory,
                            disk: overallResources.disk,
                            ports: overallResources.ports
                        },
                        usedResources: {
                            cpus: overallUsedResources.cpus,
                            memory: overallUsedResources.memory,
                            disk: overallUsedResources.disk,
                            ports: overallUsedResources.ports
                        },
                        unusedResources: {
                            cpus: overallResources.cpus-overallUsedResources.cpus,
                            memory: overallResources.memory-overallUsedResources.memory,
                            disk: overallResources.disk-overallUsedResources.disk,
                            ports: overallResources.ports-overallUsedResources.ports
                        }
                    },
                    agents: agentMap
                };

                cb(null, utilization);

            }

        });
    } catch (error) {
        cb(error, null);
    }


}

function provision (mesosCtl, options, callback) {

    // Set Ansible working directory
    var ansibleWorkDir = path.join(__dirname, "../", "ansible");

    // Set MESOSCTL_CONFIGURATION_PATH environment variable for the dynamic inventory
    process.env.MESOSCTL_CONFIGURATION_PATH = mesosCtl.currentConfigPath;

    var taskMatcher = /TASK \[(.*)\]/;
    var playMatcher = /PLAY \[(.*)\]/;
    var storedOutput = "";
    var checkOutput = false;
    var playbook = new Ansible.Playbook().playbook(ansibleWorkDir + "/provision");

    // Log the proceeding installation steps
    playbook.on('stdout', function(data) {
        var output = data.toString();
        var foundPlay = output.match(playMatcher);
        var foundTask = output.match(taskMatcher);
        var foundInclude = (output.match(/include/) === null ? false : true);
        var foundSkipped = (output.match(/skipping/) === null ? false : true); // If skipped, don't show!

        // Log playbook starts
        if (foundPlay && foundPlay.length === 2) {
            console.log("-----------------------------------------------------------");
            console.log("Starting play " + foundPlay[1]);
            console.log("-----------------------------------------------------------");
        }

        if (checkOutput) {
            if (!foundSkipped && options && options.verbose) {
                console.log("Starting task " + storedOutput);
            }
            checkOutput = false;
        } else {
            if (foundTask && foundTask.length === 2 && !foundInclude) {
                storedOutput = foundTask[1];
                checkOutput = true;
            }
        }

    });

    playbook.exec({ cwd: ansibleWorkDir }).then(function(successResult) {

        // Set as provisioned
        mesosCtl.config.provisioned = true;

        // Serialize the configuration
        mesosCtl.functions.serializeConfiguration(mesosCtl.currentConfigPath);

        callback();

    }, function(error) {

        var fatalGlobalMatcher = /(fatal:.*)/g;
        var fatalRealMatcher = /^(fatal)(?!.*?lxc-docker).*$/g;
        var globalErrors = error.toString().match(fatalGlobalMatcher);
        var realErrors = [];

        // Check if the global error signatures found match the "real" error signatures (omit ignored fatal messages)
        if (globalErrors && globalErrors.length > 0) {
            globalErrors.forEach(function (globalError) {
                var found = globalError.match(fatalRealMatcher);
                if (found && found.length > 0) {
                    realErrors.push(globalError);
                }
            });
        }

        console.log("-----------------------------------------------------------");
        console.log("Error(s) occurred:");
        console.log("-----------------------------------------------------------");
        if (realErrors && realErrors.length > 0) {
            console.log(realErrors.join("\n"));
        } else {
            console.log(error.toString());
        }

        callback();

    });

}

module.exports = function(vorpal, mesosCtl) {

    vorpal
        .command('cluster provision', 'Provisions the cluster based on the current configuration')
        .option("--verbose", "Set the verbose logging of the provision process")
        .action(function (args, callback) {

            var self = this;

            // Check if the configuration has been provisioned and if it has a valid configuration
            if (!mesosCtl.hasValidConfig || !mesosCtl.currentConfigPath) {

                self.log("--> Currently there is no valid configuration loaded! Therefore, the cluster cannot be provisioned!");
                callback();

            } else if (mesosCtl.config.provisioned) {

                self.prompt({
                    type: 'confirm',
                    name: 'reprovision',
                    default: false,
                    message: 'This configuration has already been provisioned. \nRe-provisioning can have effects on the cluster as well as all possibly running applications. Continue '
                }, function (result) {

                    // Check if the cluster should be re-provisioned
                    if (result.reprovision) {

                        // Re-provision
                        provision(mesosCtl, args.options, callback);

                    } else {

                        self.log("--> The cluster will not be re-provisioned.");
                        callback();

                    }

                });

            } else {

                // Provision
                provision(mesosCtl, args.options, callback);

            }

        });

    vorpal
        .command('cluster status', 'Display the cluster status')
        .action(function (args, callback) {
            var self = this;

            // Check if the configuration has been provisioned and if it has a valid configuration
            if (!mesosCtl.hasValidConfig || !mesosCtl.currentConfigPath) {

                self.log("--> Currently there is no valid configuration loaded!");
                callback();

            } else if (!mesosCtl.config.provisioned) {

                self.log("--> The loaded configuration was not provisioned yet!");
                callback();

            } else {

                // Get the statistics
                getUtilizationStats(mesosCtl.functions.getAgents(), function (error, utilization) {

                    if (error) {
                        self.log(chalk.red(error));
                        callback();
                    } else {
                        // Render the stats
                        renderUtilization(utilization.cluster.utilization, "Cluster '" + mesosCtl.config.cluster_name + "' utilization:");

                        // Trigger callback
                        callback();
                    }

                });

            }

        });

    vorpal
        .command('cluster status agent <agentIPAddress>', 'Display the Mesos agent status and utilization')
        .autocomplete({
            data: function () {
                if (!mesosCtl.config.masters || !mesosCtl.config.agents || !mesosCtl.config.registry) {
                    return [];
                } else {
                    return mesosCtl.functions.getUniqueItemArray(mesosCtl.config.masters.concat(mesosCtl.config.agents, mesosCtl.config.registry)).sort();
                }
            }
        })
        .action(function (args, callback) {
            var self = this;

            if (mesosCtl.config.agents.indexOf(args.agentIPAddress) > -1) {

                // Get the statistics
                getUtilizationStats(mesosCtl.config.agents, function (error, utilization) {

                    if (error) {
                        self.log(chalk.bgRed(error));
                    }

                    // Render the stats
                    renderUtilization(utilization.agents[args.agentIPAddress].utilization, "Agent " + args.agentIPAddress + " utilization:");

                    // Trigger callback
                    callback();

                });

            } else {
                self.log(chalk.red("--> The Mesos agent IP address couldn't be found in the list of configured agents!"));
                callback();
            }

        });

    vorpal
        .command('cluster ssh <ipAddress> [command]', 'Issue a SSH command on the remote host')
        .autocomplete({
            data: function () {
                if (!mesosCtl.config.masters || !mesosCtl.config.agents || !mesosCtl.config.registry) {
                    return [];
                } else {
                    return mesosCtl.functions.getUniqueItemArray(mesosCtl.config.masters.concat(mesosCtl.config.agents, mesosCtl.config.registry)).sort();
                }
            }
        })
        .action(function (args, callback) {
            var self = this;

            // Check if the configuration has been provisioned and if it has a valid configuration
            if (!mesosCtl.hasValidConfig || !mesosCtl.currentConfigPath) {

                self.log("--> Currently there is no valid configuration loaded! Therefore, the command cannot be executed!");
                callback();

            } else {

                var conn = new sshClient();

                conn.on('error', function (error) {
                    self.log("An error occurred: " + JSON.stringify(error));
                    callback();
                }).on('ready', function() {
                    conn.exec(args.command, function(error, stream) {
                        if (error) {
                            self.log("--> An error occurred: " + JSON.stringify(error));
                        }
                        stream.on('close', function(code, signal) {
                            conn.end();
                            callback();
                        }).on('data', function(data) {
                            self.log(data.toString());
                        }).stderr.on('data', function(data) {
                            self.log(data.toString());
                        });
                    });
                }).connect({
                    host: args.ipAddress,
                    port: mesosCtl.config.ssh_port,
                    username: mesosCtl.config.ssh_user,
                    privateKey: require('fs').readFileSync(mesosCtl.config.ssh_key_path)
                });

            }

        });

    vorpal
        .command("cluster get leader", "Returns the currently leading Mesos Master's address")
        .action(function (args, callback) {
            var self = this;

            // Check if the configuration has been provisioned and if it has a valid configuration
            if (!mesosCtl.hasValidConfig || !mesosCtl.currentConfigPath) {

                self.log("--> Currently there is no valid configuration loaded! Therefore, the command cannot be executed!");
                callback();

            } else {
                mesosCtl.functions.getLeader(function (error, leaderIP) {
                    if (error) {
                        self.log("--> An error occured: " + JSON.stringify(error));
                        callback();
                    } else {
                        self.log("--> Current leading Master's address is " + leaderIP);
                        callback();
                    }
                })
            }
        });

    return vorpal;

};