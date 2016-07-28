# mesosctl

A command-line tool to dynamically provision and manage Mesos clusters and their applications.
 
## Motivation

When `mesosctl` was started as a project, Mesosphere's [DC/OS](http://www.dcos.io) was only available for local installations for paying customers. 
So, with the creation of `mesosctl` the goal was to provide a simple and reliable way of creating and running Mesos clusters on own infrastructure. 
In the meantime, DC/OS has been open-sourced, but there assumingly is room for another, although maybe simpler (both in installation, usage and functionality) tool besides DC/OS. 
That's why we decided to finish and open-source `mesosctl` as well.

You might think of `mesosctl` as a mixture of [DC/OS](http://www.dcos.io) and [minimesos](https://github.com/ContainerSolutions/minimesos), providing not as much sophistication as DC/OS, but is also able to run universe packages. 

## Concepts

`mesosctl` is running a "sub-shell" application (written as a Node.js module using [vorpal.js](https://github.com/dthree/vorpal)), meaning it starts a process which keeps the state of the configurations in memory. Unless you `exit` the `mesosctl` shell, you can directly interact with you cluster.

It uses [Ansible](http://docs.ansible.com/ansible/intro_installation.html) to run the OS-individal tasks to set up a Mesos cluster. This is based on configuration files which are stored as YAML (see [Usage](#usage)).

After the cluster has been set up, `mesosctl` uses the APIs of the Mesos Masters/Agents, as well as the Marathon API to provide the interactive functionality.

## Status

The current version is `0.1.6`, which is an early release. We consider it as `alpha` and a developer preview.

## Installation

The preferred ways to run `mesosctl` is either via local NPM installation, or via the [mesoshq/mesosctl](https://hub.docker.com/r/mesoshq/mesosctl) Docker image. Currently, we only
provide a command-line installation. A GUI installer will follow in the future.

### mesosctl CLI installation
 
**NPM**

You can install the NPM package globally by running

    npm install mesosctl -g

When installing via the NPM package, `mesosctl` expects the following tools to by present on your system:

* [Node.js](https://nodejs.org/en/download/) >= 4 and [NPM](https://www.npmjs.com/)
* [Ansible](http://docs.ansible.com/ansible/intro_installation.html) >= 2.0.2.0

**Docker**

You can start the Docker image by running

    docker run --net=host -it mesoshq/mesosctl mesosctl
    
If you want to use pre-existing local configurations, please map the relevant folder as a volume like this: 

    -v /path/to/local/config:/opt/mesosctl/config

Also, make sure that you host's network settings are configured in a way that the Docker daemon networking can "see" the Vagrant networks.

You can also use a Bash wrapper script, which you should place somewhere in the `PATH`, e.g. save the script somewhere and create a symlink to `/usr/local/bin`:

```bash
#!/bin/bash

# Create .mesosctl folder in user's home directory is it doesn't exist
mkdir -p ~/.mesosctl

# Run Docker image and map the local configuration folder
docker run --net=host -it -e MESOSCTL_CONFIGURATION_BASE_PATH=/config -v ~/.mesosctl:/config:rw mesoshq/mesosctl mesosctl

``` 

### Local / Vagrant cluster installation

For testing and local development, one of the provided Vagrant cluster configurations can be used:
 
 * [mesoshq/vagrant-cluster-coreos](https://github.com/mesoshq/vagrant-cluster-coreos) (using CoreOS stable latest)
 * [mesoshq/vagrant-cluster-ubuntu](https://github.com/mesoshq/vagrant-cluster-ubuntu) (using Ubuntu 14.04 latest)
 * [mesoshq/vagrant-cluster-centos](https://github.com/mesoshq/vagrant-cluster-centos) (using CentOS 7 latest)

Obviously, you'll need a working [Vagrant](https://www.vagrantup.com/downloads.html) installation (>= v1.8, with VirtualBox).

### Remote installation

You can use `mesosctl` to install Mesos clusters on freshly installed Linux machines. It currently supports the following OS families/flavors:

* CoreOS
* Debian
 * Debian Jessie
 * Ubuntu Xenial
 * Ubuntu Vivid
 * Ubuntu Trusty
* RedHat
 * CentOS 7
 * CentOS 6
 * RHEL 7
 * RHEL 6
 * Fedora
 
The requirements on the remote machines which should be utilized by `mesosctl` are the following:

* A common user with sufficient permission to install packages and run services, as well as the belonging SSH key of this user to be able to connect via SSH. This SSH key needs to be present on the machine you're running `mesosctl` on.
* A Python version >= 2.4 (but if you are running less than Python 2.5 on the remotes, you will also need `python-simplejson`)
* Network connectivity to see the other hosts of the cluster
* Internet access (installer packages and Docker images are downloaded during installation)

The remote machines need to be reachable from the host you're running `mesosctl` on, otherwise the installation will fail. 

#### Using cloud providers

Currently, either the direct access via SSH is supported, or via a preconfigured and running "SSH over VPN" connection.
 
See the following links on how to configure SSH access for cloud-hosted nodes:

* [AWS](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstancesLinux.html)
* [GCE](https://cloud.google.com/compute/docs/instances/connecting-to-instance)
* [DigitalOcean](https://www.digitalocean.com/community/tutorials/how-to-use-ssh-keys-with-digitalocean-droplets)
* [Azure](https://azure.microsoft.com/de-de/documentation/articles/virtual-machines-linux-ssh-from-linux/)

## Usage

Once you have installed `mesosctl` either as global NPM module or as Docker container (having the wrapper script in the path), you can use

```bash
$ mesosctl
```

to open the `mesosctl` sub-shell application.

### Create a configuration file

Configuration files for `mesosctl` are YAML files. To be able to provision a Mesos cluster, you'll need to specify the following details:

* `cluster_name`: The desired cluster name. Must be a `string` containg no spaces.
* `os_family`:    The OS family. Must be one of `CoreOS`, `Debian` or `RedHat` (see [Remote installation](#remote-installation)).
* `ssh_key_path`: The (absolute) path to the SSH key which provides access to all hosts. This must be the same for all hosts.
* `ssh_user`:     The username belonging to the SSH key specified above. This must be the same for all hosts.
* `ssh_port`:     The SSH port to access all hosts. This must be the same for all hosts.
* `dns_servers`:  The list of external DNS resolvers.
* `masters`:      The list of IP addresses which should be provisioned as Mesos masters.
* `agents`:       The list of IP addresses which should be provisioned as Mesos agents.
* `registry`:     The IP address which should be provisioned as private Docker registry.

An example configuration file is the following:

```bash
cluster_name: my_first_mesos_cluster
os_family: Debian
ssh_key_path: /Users/developer/.vagrant.d/insecure_private_key
ssh_port: 22
ssh_user: vagrant
dns_servers:
  - 8.8.8.8
  - 8.8.4.4
masters:
  - 172.17.10.101
  - 172.17.10.102
  - 172.17.10.103
agents:
  - 172.17.10.101
  - 172.17.10.102
  - 172.17.10.103
registry:
  - 172.17.10.101
```


### Using pre-existing configurations

If you have a pre-existing configuration file (e.g. when you use a Vagrant cluster setup), you can use the following command to load it:

```bash
mesosctl $ config load /path/to/mesosctl.yml
```

### Create a configuration via `mesosctl`

Have a look at the [config set](#configuration) commands to create the cluster configuration manually. The list of [mandatory fields](#create-a-configuration-file) applies.

### Cluster provisioning

Once you have a configuation, you can run

```bash
mesosctl $ config validate
--> The current configuration is valid!
```

If the configuration is valid, then you can start with the provisioning of the cluster:

```bash
mesosctl $ cluster provision --verbose
```

This may take a while, because `mesosctl` will trigger the installation of all required software on the configured cluster hosts. Once the provisioning of the cluster is finished, you'll have a 3 node cluster, where each node is running the Mesos Master, the Mesos Agent and a Marathon instance. The respective IP addresses can also be found in the Vagrant project's docs. You also check the cluster status via mesosctl` like this:

```bash
mesosctl $ cluster status

Cluster 'mesos_cluster_ubuntu' utilization:

  CPU    [==                  ] 10%
  Memory [=                   ] 6%
  Disk   [                    ] 0%
  Ports  [                    ] 0%
```

You can also retrieve the current leader's address, which you can use in a browser to get the Mesos Master's UI:

```bash
mesosctl $ cluster get leader
--> Current leading Master's address is 172.17.10.103:5050
```

## Command reference

You can use the following commands with `mesosctl`:

### Configuration

You can create, update and load existing configurations.

```
config create                                Creates a configuration
config load [pathToConfig]                   Loads an existing configuration, either from specified path or from a selection of existing configurations
config show                                  Displays the current configuration
config validate                              Validates the current configuration
config get clustername                       Gets the cluster name
config set clustername <clusterName>         Defines the cluster name
config set os                                Defines the OS type
config get os                                Gets the OS type
config set ssh.keypath <path>                Defines the path to the SSH key for accessing the hosts
config get ssh.keypath                       Gets the path to the SSH key for accessing the hosts
config set ssh.user <userName>               Defines the user name for the SSH key for accessing the hosts
config get ssh.user                          Gets the user name for the SSH key for accessing the hosts
config set ssh.port <port>                   Defines the port for the SSH connection for accessing the hosts
config get ssh.port                          Gets the port for the SSH connection for accessing the hosts
config set admin.user <userName>             Defines the admin user name
config get admin.user                        Gets the admin user name
config set admin.password <password>         Defines the admin password
config set dns.servers [dnsServer...]        Defines the DNS nameservers
config add dns.servers [dnsServer...]        Adds IP address(es) to the DNS nameserver list
config remove dns.servers [dnsServer...]     Remove IP address(es) from the DNS nameserver list
config set masters [masterServer...]         Defines the Mesos Master servers
config add masters [masterServer...]         Adds IP address(es) to the Mesos Master server list
config remove masters [masterServer...]      Remove IP address(es) from the Mesos Master servers list
config set agents [agentServer...]           Defines the Mesos Agent servers
config add agents [agentServer...]           Adds IP address(es) to the Mesos Agent server list
config remove agents [agentServer...]        Remove IP address(es) from the Mesos Agent servers list
config set registry <registryServer>         Defines the private Docker Registry server
config get registry                          Gets the private Docker Registry server IP address
```

### Cluster

You can provison a cluster based on the before defined configuration, and get status information as well as connect to nodes via SSH.

```
cluster provision [options]                  Provisions the cluster based on the current configuration
cluster status                               Display the cluster status
cluster status agent <agentIPAddress>        Display the Mesos agent status and utilization
cluster ssh <ipAddress> [command]            Issue a SSH command on the remote host. The command must be wrapped in double quotation marks, like `"ls -la"`.
cluster get leader                           Returns the currently leading Mesos Master's IP address
```

### Repository

You can use the standard DC/OS (Mesosphere) universe repository.

```
repository install                           Download and installs the current DC/OS Universe repository
repository update                            Updates the local DC/OS Universe repository with the remote
repository check                             Checks if the DC/OS Universe repository is installed locally
```

### Packages

You (un)install packages from the DC/OS universe repository. Please be aware that `mesosctl` cannot programatically check whether the actual configuration supports the chosen package from a resource perspective (number of nodes, available cpus and memory), because this information is currently not exposed in the package definitions.

```
package install [options] <packageName>      Installs a package
package describe [options] <packageName>     Displays information about a package
package uninstall <packageName>              Uninstalls a package
package search <searchString>                Searches for packages with specific string
```

### Marathon applications and groups

You can start and manage applications/groups via Marathon. 

```
marathon info list                           Shows information about the running Marathon instance
marathon app list                            Lists all running apps
marathon app remove <appId>                  Removes a specific app (i.e. stops the app)
marathon app restart <appId>                 Restarts a specific app
marathon app show <appId>                    Show the configuration details of a specific app
marathon app start <pathToJSON>              Starts an app with a specific configuration
marathon app update <appId> [properties...]  Updates a running specific app
marathon app version list <appId>            Display the version list for a specific app
marathon app scale <appId> <instances>       Scales (up od down) a specific app
marathon deployment list                     Lists all current deployments
marathon deployment rollback <deploymentId>  Triggers a rollback of a specific deployment
marathon deployment remove <deploymentId>    Removes/stops a specific deployment
marathon group add <pathToJSON>              Adds a new group
marathon group list                          Lists all current groups
marathon group scale <groupId> <instances>   Scales (up or down) a specifc group
marathon group show <groupId>                Show details about a specific group
marathon group remove <groupId>              Remove/stop a specific group
marathon task list                           Show all running tasks
marathon task show <taskId>                  Show details about a specify running task
```

### Tasks

You can introspect running tasks from the leading Mesos master.

```
task list [options]                          Lists all task in the cluster
task show [options] <task>                   Retrieves information about a task
task log [options] <taskId> [file]           Print the task log. By default, the 10 most recent task logs from stdout are printed.
task ls <taskId> [path]                      Print the list of files in the Mesos task sandbox
```