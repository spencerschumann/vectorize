FROM fedora:43

# Use DNF in Fedora images
RUN dnf -y update && \
   dnf -y install \
   ImageMagick \
   autotrace \
   poppler-utils \
   ghostscript \
   ca-certificates \
   dejavu-sans-fonts \
   pipx \
   inkscape \
   && dnf clean all

# Non-root user
#RUN groupadd -r app && useradd -r -m -g app app

#WORKDIR /home/app
#USER app

# Default: show versions. Override to run conversions.
CMD ["bash","-lc","magick --version && autotrace --version"]