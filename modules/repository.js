var path = require("path"),
    fs = require("fs");

module.exports = function(vorpal, mesosCtl) {

    vorpal
        .command("repository install", "Download and installs the current DC/OS Universe repository")
        .action(function(args, callback) {

            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> Installing the DC/OS repository locally!");
                mesosCtl.functions.downloadRepository();
                self.log("--> Initializing the local package index!");
                mesosCtl.functions.initPackageIndex();
                self.log("--> Done!");
                callback();
            } else {
                self.log("--> The DC/OS Universe repository has already been downloaded. You can update it by running 'repository update'.");
                callback();
            }

        });

    vorpal
        .command("repository update", "Updates the local DC/OS Universe repository with the remote")
        .action(function(args, callback) {

            var self = this;

            self.log("--> Downloading the latest DC/OS repository!");
            mesosCtl.functions.downloadRepository();
            self.log("--> Updating the local DC/OS repository and package index!");
            mesosCtl.functions.initPackageIndex();
            self.log("--> Done!");

            callback();

        });

    vorpal
        .command("repository check", "Checks if the DC/OS Universe repository is installed locally")
        .action(function(args, callback) {

            var self = this;

            if (!mesosCtl.functions.checkRepository()) {
                self.log("--> The DC/OS Universe repository has not yet been downloaded. Run 'repository install' to retrieve the current version.");
                callback();
            } else {
                self.log("--> The DC/OS Universe repository has been downloaded. Packages can be installed via 'package install'.");
                callback();
            }

        });

    return vorpal;

};