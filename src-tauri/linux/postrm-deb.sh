# Debian / Ubuntu (postrm) : $1 = remove ou purge à la désinstallation, upgrade lors d'une mise à jour.
# Même rôle que postun.sh (Fedora) : supprimer les dossiers vides laissés par le paquet.
case "$1" in
  remove|purge)
    rmdir "/usr/lib/SXM Archive/bin" "/usr/lib/SXM Archive/licenses" "/usr/lib/SXM Archive" 2>/dev/null || :
    ;;
esac
