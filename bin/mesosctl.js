#! /usr/bin/env node
var vorpal = require('vorpal')(),
    mesosCtl = require("../lib/mesosCtl")();

vorpal = require("../modules/config")(vorpal, mesosCtl);
vorpal = require("../modules/cluster")(vorpal, mesosCtl);
vorpal = require("../modules/package")(vorpal, mesosCtl);
vorpal = require("../modules/marathon")(vorpal, mesosCtl);
vorpal = require("../modules/repository")(vorpal, mesosCtl);
vorpal = require("../modules/task")(vorpal, mesosCtl);

process.on('uncaughtException', function (error) {
    console.log("Caught exception: ");
    console.log(error.stack);
});

vorpal
    .delimiter('mesosctl $ ')
    .show();
