' Starts the supervisor of the journal server without a window. Paths are counted from this file.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.Run "node backend\node\supervisor.js", 0, False
