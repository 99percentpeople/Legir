; Keep Windows file association identity aligned with the shipped executable name.

!macro NSIS_HOOK_POSTINSTALL
  DeleteRegValue HKCU "Software\RegisteredApplications" "Legir"
  DeleteRegKey HKCU "Software\Legir\Capabilities\FileAssociations"
  DeleteRegKey HKCU "Software\Legir\Capabilities"
  DeleteRegKey HKCU "Software\Legir"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "Legir.pdf"
  DeleteRegKey HKCU "Software\Classes\Legir.pdf"
  DeleteRegKey HKCU "Software\Classes\Applications\Legir.exe"
  WriteRegStr SHCTX "Software\Legir\Capabilities" "ApplicationName" "Legir"
  WriteRegStr SHCTX "Software\Legir\Capabilities" "ApplicationDescription" "Lightweight AI PDF Reader"
  WriteRegStr SHCTX "Software\Legir\Capabilities\FileAssociations" ".pdf" "Legir.pdf"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Legir" "Software\Legir\Capabilities"
  WriteRegStr SHCTX "Software\Classes\Legir.pdf" "" "Legir PDF Document"
  WriteRegStr SHCTX "Software\Classes\Legir.pdf\DefaultIcon" "" "$INSTDIR\pdf-document.ico,0"
  WriteRegStr SHCTX "Software\Classes\Legir.pdf\shell" "" "open"
  WriteRegExpandStr SHCTX "Software\Classes\Legir.pdf\shell\open\command" "" '$\"$INSTDIR\Legir.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "Legir.pdf" ""
  WriteRegExpandStr SHCTX "Software\Classes\Applications\Legir.exe\DefaultIcon" "" "$INSTDIR\pdf-document.ico,0"
  WriteRegStr SHCTX "Software\Classes\Applications\Legir.exe" "FriendlyAppName" "Legir"
  WriteRegStr SHCTX "Software\Classes\Applications\Legir.exe\SupportedTypes" ".pdf" ""
  WriteRegExpandStr SHCTX "Software\Classes\Applications\Legir.exe\shell\open\command" "" '$\"$INSTDIR\Legir.exe$\" $\"%1$\"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Legir"
  DeleteRegKey SHCTX "Software\Legir\Capabilities\FileAssociations"
  DeleteRegKey SHCTX "Software\Legir\Capabilities"
  DeleteRegKey SHCTX "Software\Legir"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "Legir.pdf"
  DeleteRegKey SHCTX "Software\Classes\Legir.pdf"
  DeleteRegKey SHCTX "Software\Classes\Applications\Legir.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
