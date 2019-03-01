# Docker development environment for express-processimage
#
# This Dockerfile is for development only.
#
# It is built to closely resemble the Travis CI environment, to make the
# development experience as flawless as possible.
#
# Based on https://github.com/creationix/nvm/blob/a1abfd1fe42308599b77461eb15460427fe05b9e/Dockerfile#L16

FROM ubuntu:14.04
LABEL maintainer="Gustav Nikolaj <gustavnikolaj@gmail.com>"
LABEL name="express-processimage-dev"
LABEL version="latest"

# Set the SHELL to bash with pipefail option
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Prevent dialog during apt install
ENV DEBIAN_FRONTEND noninteractive

# Pick a Ubuntu apt mirror site for better speed
# ref: https://launchpad.net/ubuntu/+archivemirrors
ENV UBUNTU_APT_SITE mirror.one.com

# Disable src package source
RUN sed -i 's/^deb-src\ /\#deb-src\ /g' /etc/apt/sources.list

# Replace origin apt package site with the mirror site
RUN sed -E -i "s/([a-z]+.)?archive.ubuntu.com/$UBUNTU_APT_SITE/g" /etc/apt/sources.list
RUN sed -i "s/security.ubuntu.com/$UBUNTU_APT_SITE/g" /etc/apt/sources.list

# Install apt packages
RUN apt-get update && \
  apt-get install -y \
    git \
    wget \
    optipng \
    pngcrush \
    pngquant \
    graphicsmagick \
    libjpeg-turbo-progs \
    inkscape \
    libcairo2-dev \
    libgif-dev \
    libjpeg8-dev \
    zlib1g-dev

# Set locale
RUN locale-gen en_US.UTF-8

# Add user "nvm" as non-root user
RUN useradd -ms /bin/bash nvm

# Set sudoer for "nvm"
RUN echo 'nvm ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

# Switch to user "nvm" from now
USER nvm

# nvm
RUN wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash

# Set WORKDIR to nvm directory
WORKDIR /home/nvm/express-processimage

# Install node version 8 (keep in sync with .travis.yml)
RUN bash -c 'source $HOME/.nvm/nvm.sh && nvm install 8'

ENTRYPOINT ["/bin/bash"]

