# Désinstallation complète ($1 = 0) : supprimer les dossiers vides laissés par le paquet
if [ "$1" -eq 0 ]; then
  rmdir "/usr/lib/SXM Archive/bin" "/usr/lib/SXM Archive/licenses" "/usr/lib/SXM Archive" 2>/dev/null || :
fi
