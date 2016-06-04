ansible-docker - Ansible Playbook for Docker
==============

## Overview

The `ansible-docker` role supports the installation and configuration of Docker Engine. It supports Ubuntu and RedHat/Centos.

## Requirements

No requirement.


## Development

Changes can be tested by using Vagrant machines configure for this role, see `Vagrantfile`.

```bash
cd ansible-docker/
vagrant up {travis|ubuntu|centos7}
vagrant ssh {travis|ubuntu|centos7}

$ cd roles/ansible-docker/
$ ansible-playbook -i ci/inventory ci/playbook.yml --connection=local --sudo

PLAY [localhost] ************************************************************** 

GATHERING FACTS *************************************************************** 
ok: [localhost]

...

TASK: [command docker run hello-world] **************************************** 
changed: [localhost]

PLAY RECAP ******************************************************************** 
localhost                  : ok=12   changed=1    unreachable=0    failed=0   
```

Support open source!

