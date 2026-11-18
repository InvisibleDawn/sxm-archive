; Clic droit dans l'Explorateur : « Compresser avec SXM Archive » (fichiers et dossiers)
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\*\shell\SXMArchiveAdd" "" "Compresser avec SXM Archive"
  WriteRegStr HKCU "Software\Classes\*\shell\SXMArchiveAdd" "Icon" "$INSTDIR\sxm-archive.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\SXMArchiveAdd\command" "" '"$INSTDIR\sxm-archive.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\SXMArchiveAdd" "" "Compresser avec SXM Archive"
  WriteRegStr HKCU "Software\Classes\Directory\shell\SXMArchiveAdd" "Icon" "$INSTDIR\sxm-archive.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\SXMArchiveAdd\command" "" '"$INSTDIR\sxm-archive.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\*\shell\SXMArchiveAdd"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SXMArchiveAdd"
!macroend
