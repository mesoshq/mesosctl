var request = require("request"),
    AsciiTable = require('ascii-table'),
    MesosDNSAgent = require("mesosdns-http-agent");

function getSlaveInfo(slaveBaseUrl, cb) {

    var options = {
        url: slaveBaseUrl + "/state",
        method: "GET",
        json: true
    };

    request(options, function (error, response, body) {
        if (error) {
            cb(error, null);
        } else {
            cb(null, body);
        }
    });

}

function getFileList(slaveBaseUrl, path, mesosCtl, cb) {

    var options = {
        url: slaveBaseUrl + "/files/browse?path=" + encodeURIComponent(path),
        method: "GET",
        json: true
    };

    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    request(options, function (error, response, filesArray) {
        if (error) {
            cb(error, null);
        } else {

            if (response.statusCode === 404) {
                cb("The requested path couldn't be found for this executor!", null);
            } else if (response.statusCode >= 200 && response.statusCode < 400) {
                var resultArray = [],
                    maxLengths = {};

                // Get the max lengths
                filesArray.forEach(function (fileObj) {
                    var fileNameArray = fileObj.path.split("\/"),
                        fileDate = new Date(fileObj.mtime*1000);
                    fileObj.fileName = fileNameArray[fileNameArray.length-1];
                    fileObj.dateString = months[fileDate.getMonth()] + " " + fileDate.getDate() + " " + fileDate.getFullYear() + " " + (fileDate.getHours() < 10 ? "0" + fileDate.getHours() : fileDate.getHours()) + ":" + (fileDate.getMinutes() < 10 ? "0" + fileDate.getMinutes() : fileDate.getMinutes());
                    Object.getOwnPropertyNames(fileObj).forEach(function (property) {
                        if (!maxLengths.hasOwnProperty(property)) {
                            maxLengths[property] = fileObj[property].toString().length;
                        } else {
                            if (maxLengths[property] < fileObj[property].toString().length) {
                                maxLengths[property] = fileObj[property].toString().length;
                            }
                        }
                    });
                });

                // Format entries
                filesArray.forEach(function (fileObj) {
                    resultArray.push(fileObj.mode + mesosCtl.functions.leftPad(fileObj.uid, maxLengths.uid+2, " ") + mesosCtl.functions.leftPad(fileObj.gid, maxLengths.gid+2, " ") + mesosCtl.functions.leftPad(fileObj.size, maxLengths.size+2, " ") + mesosCtl.functions.leftPad(fileObj.dateString, maxLengths.dateString+2, " ") + " " + fileObj.fileName);
                });

                cb(null, resultArray);
            } else {
                cb("An unknown error occurred!", null);
            }

        }
    });

}

function getFileContents(slaveBaseUrl, path, lines, offset, cb) {

    var options = {
        url: slaveBaseUrl + "/files/read?path=" + encodeURIComponent(path) + (offset !== null ? "&offset=" + offset : ""), //  + (lines ? "&length=" + lines : "") +
        method: "GET",
        json: true
    };

    request(options, function (error, response, body) {
        if (error) {
            cb(error, null);
        } else {

            if (response.statusCode === 404) {
                cb("The requested file couldn't be found for this executor!", null);
            } else if (response.statusCode >= 200 && response.statusCode < 400) {
                var data = body.data;
                var linesArray = data.split("\n");

                // Check if it's an array
                if (Array.isArray(linesArray)) {
                    if (linesArray.length <= lines) {
                        cb(null, linesArray);
                    } else {
                        cb(null, linesArray.slice((parseInt(lines)+1)*-1));
                    }

                } else {
                    cb(null, linesArray);
                }
            } else {
                cb("An unknown error occurred!", null);
            }

        }
    });

}

function getTasks(dnsServers, includeCompletedTasks, searchString, cb) {

    var options = {
        agentClass: MesosDNSAgent,
        agentOptions: {
            "dnsServers": dnsServers,
            "mesosTLD": ".mesos"
        },
        url: "http://leader.mesos:5050/state"
    };

    try {
        request(options, function (error, response, body) {
            if (error) {
                cb(error, null);
            } else {
                var data = JSON.parse(body);
                var taskMap = {};
                var taskObj = {
                    slaveMap: {},
                    frameworkMap: {},
                    taskMap: {}
                };

                // Get slaveMap for faster references
                if (data.slaves && data.slaves.length > 0) {
                    data.slaves.forEach(function (slave) {
                        var info = slave.pid.split("@");
                        taskObj.slaveMap[slave.id] = {
                            name: info[0],
                            host: slave.hostname,
                            port: info[1].split(":")[1]
                        }
                    });
                }

                // Create task array
                if (data.frameworks && data.frameworks.length > 0) {
                    data.frameworks.forEach(function (framework) {
                        taskObj.frameworkMap[framework.id] = framework.name;
                        framework.tasks.forEach(function (task) {
                            delete task.statuses;
                            delete task.discovery;
                            delete task.container;
                            taskMap[task.id] = task;
                        });
                        if (includeCompletedTasks) {
                            framework.completed_tasks.forEach(function (task) {
                                delete task.statuses;
                                delete task.discovery;
                                delete task.container;
                                taskMap[task.id] = task;
                            });
                        }
                    });
                }

                // Filter for search string
                Object.getOwnPropertyNames(taskMap).forEach(function (taskId) {
                    var task = taskMap[taskId];
                    // Only filter is searchString is actually not null
                    if (searchString) {
                        var searchObj = new RegExp(searchString, "gi");
                        if (searchObj.test(task.id)) {
                            taskObj.taskMap[taskId] = task;
                        }
                    } else {
                        taskObj.taskMap[taskId] = task;
                    }

                });

                cb(null, taskObj);
            }

        });
    } catch (error) {
        cb(error, null);
    }

}

module.exports = function(vorpal, mesosCtl) {

    vorpal
        .command("task list", "Lists all task in the cluster")
        .option("--completed", "Print completed and in-progress tasks")
        .option("--json", "Print JSON-formatted list of tasks")
        .action(function(args, callback) {

            var self = this,
                includeCompletedTasks = (args.options.completed ? true : false);

            getTasks(mesosCtl.functions.getAgents(), includeCompletedTasks, null, function (error, tasksObj) {

                if (error) {

                    self.log("--> An error occurred: " + error);
                    callback();

                } else {

                    if (args.options.json) {

                        Object.getOwnPropertyNames(tasksObj.taskMap).forEach(function (taskId) {
                            self.log("--> Found task " + taskId);
                            self.log(JSON.stringify(tasksObj.taskMap[taskId]));
                        });

                        callback();

                    } else {

                        var table = new AsciiTable();
                        table.setHeading("Task ID", "Task Name", "Framework Name", "Slave Name", "CPUs", "Memory", "Disk", "Port(s)", "State");

                        Object.getOwnPropertyNames(tasksObj.taskMap).forEach(function (taskId) {
                            var task = tasksObj.taskMap[taskId];
                            table.addRow(task.id, task.name, tasksObj.frameworkMap[task.framework_id], tasksObj.slaveMap[task.slave_id].name+"@"+tasksObj.slaveMap[task.slave_id].host+":"+tasksObj.slaveMap[task.slave_id].port, task.resources.cpus, task.resources.mem, task.resources.disk, task.resources.ports.replace("[", "").replace("]", ""), task.state);
                        });

                        self.log(table.toString());

                        callback();

                    }

                }

            });

        });

    vorpal
        .command("task show <task>", "Retrieves information about a task")
        .option("--completed", "Print completed and in-progress tasks")
        .option("--json", "Print JSON-formatted list of tasks")
        .action(function(args, callback) {

            var self = this,
                includeCompletedTasks = (args.options.completed ? true : false);

            getTasks(mesosCtl.functions.getAgents(), includeCompletedTasks, args.task, function (error, tasksObj) {

                if (error) {

                    self.log("--> An error occurred: " + error);
                    callback();

                } else {

                    if (args.options.json) {

                        Object.getOwnPropertyNames(tasksObj.taskMap).forEach(function (taskId) {
                            self.log("--> Found task " + taskId);
                            self.log(JSON.stringify(tasksObj.taskMap[taskId]));
                        });

                        callback();

                    } else {

                        var table = new AsciiTable();
                        table.setHeading("Task ID", "Task Name", "Framework Name", "Slave Name", "CPUs", "Memory", "Disk", "Port(s)", "State");

                        Object.getOwnPropertyNames(tasksObj.taskMap).forEach(function (taskId) {
                            var task = tasksObj.taskMap[taskId];
                            table.addRow(task.id, task.name, tasksObj.frameworkMap[task.framework_id], tasksObj.slaveMap[task.slave_id].name+"@"+tasksObj.slaveMap[task.slave_id].host+":"+tasksObj.slaveMap[task.slave_id].port, task.resources.cpus, task.resources.mem, task.resources.disk, task.resources.ports.replace("[", "").replace("]", ""), task.state);
                        });

                        self.log(table.toString());

                        callback();

                    }

                }

            });

        });

    vorpal
        .command("task log <taskId> [file]", "Print the task log. By default, the 10 most recent task logs from stdout are printed.")
        .option("--completed", "Print completed and in-progress tasks")
        .option("--json", "Print JSON-formatted list of tasks")
        .option("--lines <N>", "Print the last N lines. The default is 10 lines.")
        .action(function(args, callback) {

            var self = this,
                includeCompletedTasks = (args.options.completed ? true : false),
                taskId = args.taskId.trim(),
                fileName = (args.file ? args.file : "stdout"),
                lines = (args.options && args.options.lines ? parseInt(args.options.lines) : 10);

            // Get the tasks
            getTasks(mesosCtl.functions.getAgents(), includeCompletedTasks, null, function (error, tasksObj) {

                if (error) {

                    self.log("--> An error occurred: " + error);
                    callback();

                } else {

                    // Check if we have a matching taskId
                    if (Object.getOwnPropertyNames(tasksObj.taskMap).indexOf(taskId) === -1) {
                        self.log("--> The task with the id " + args.taskId + " couldn't be found!");
                        callback();
                    } else {

                        var slaveId = tasksObj.taskMap[taskId].slave_id;
                        var frameworkId = tasksObj.taskMap[taskId].framework_id;
                        var slaveBaseUrl = "http://" + tasksObj.slaveMap[slaveId].host + ":" + tasksObj.slaveMap[slaveId].port;

                        // Get slave info
                        getSlaveInfo(slaveBaseUrl + "/" + tasksObj.slaveMap[slaveId].name, function (error, slaveInfoObj) {

                            if (error) {

                                self.log("--> An error occurred: " + error);
                                callback();

                            } else {

                                // Iterate over frameworks
                                slaveInfoObj.frameworks.forEach(function (frameworkObj) {

                                    // Match the frameworkId
                                    if (frameworkObj.id === frameworkId) {

                                        // Iterate over the executors
                                        frameworkObj.executors.forEach(function (executor) {

                                            // Match the taskId
                                            if (executor.source === taskId) {

                                                // Get the file contents if we have a match
                                                getFileContents(slaveBaseUrl, executor.directory + "/" + fileName, lines, 0, function (error, fileContentArray) {

                                                    if (error) {

                                                        self.log("--> An error occurred: " + error);
                                                        callback();

                                                    } else {

                                                        self.log("--> Displaying the contents of file '" + fileName + "':");
                                                        self.log(fileContentArray.join("\n"));
                                                        callback();

                                                    }

                                                });

                                            }

                                        });
                                    }

                                });

                            }

                        });

                    }

                }

            });

        });

    vorpal
        .command("task ls <taskId> [path]", "Print the list of files in the Mesos task sandbox")
        .action(function(args, callback) {

            var self = this,
                taskId = args.taskId;

            // Get the tasks
            getTasks(mesosCtl.functions.getAgents(), false, null, function (error, tasksObj) {

                if (error) {

                    self.log("An error occurred: " + error);
                    callback();

                } else {

                    // Check if we have a matching taskId
                    if (Object.getOwnPropertyNames(tasksObj.taskMap).indexOf(taskId) === -1) {
                        self.log("The task with the id " + args.taskId + " couldn't be found!");
                        callback();
                    } else {

                        var slaveId = tasksObj.taskMap[taskId].slave_id;
                        var frameworkId = tasksObj.taskMap[taskId].framework_id;
                        var slaveBaseUrl = "http://" + tasksObj.slaveMap[slaveId].host + ":" + tasksObj.slaveMap[slaveId].port;

                        // Get slave info
                        getSlaveInfo(slaveBaseUrl + "/" + tasksObj.slaveMap[slaveId].name, function (error, slaveInfoObj) {

                            if (error) {

                                self.log("An error occurred: " + error);
                                callback();

                            } else {

                                // Iterate over frameworks
                                slaveInfoObj.frameworks.forEach(function (frameworkObj) {

                                    // Match the frameworkId
                                    if (frameworkObj.id === frameworkId) {

                                        // Iterate over the executors
                                        frameworkObj.executors.forEach(function (executor) {

                                            // Match the taskId
                                            if (executor.source === taskId) {

                                                // Get the file contents if we have a match
                                                getFileList(slaveBaseUrl, executor.directory, mesosCtl, function (error, filesArray) {

                                                    if (error) {

                                                        self.log("An error occurred: " + error);
                                                        callback();

                                                    } else {

                                                        //self.log("Displaying the contents of file '" + fileName + "':");
                                                        self.log(filesArray.join("\n"));
                                                        callback();

                                                    }

                                                });

                                            }

                                        });
                                    }

                                });

                            }

                        });

                    }

                }

            });

        });

    return vorpal;

};