Diese deutsche Übersetzung ist ein Entwurf: Muttersprachler haben sie noch nicht geprüft. Wenn Ihnen ein Fehler oder eine holprige Formulierung auffällt, [schlagen Sie eine Korrektur vor](https://github.com/PiwiTests/platform/issues/new?template=translation.yml).

Piwi Picker findet den Locator für jedes Element der Seite, die Sie gerade ansehen. Jeder Kandidat wird nach seiner Stabilität sortiert und dann auf der Seite, wie sie gerade ist, gezählt, sodass der oberste genau ein Element findet. Die Erweiterung macht außerdem aus einem Ablauf, den Sie über mehrere Seiten durchklicken, einen lauffähigen Playwright-Test.

**Die Werkzeuge, direkt auf der Seite**

- **Element wählen**: die sortierten Locators eines Elements, auf der Seite geprüft, zum Kopieren als Locator, als Aktionszeile oder als Assertion.
- **Untersuchen**: der beste Locator des Elements unter der Maus.
- **Konsole**: Geben Sie einen Locator ein und sehen Sie, was er gerade findet, mit dem Ergebnis des Strict Mode.
- **Mehrfachauswahl**: das gemeinsame Muster der Zeilen oder Karten einer Liste.
- **Prüfung**: die Elemente, die in einem Test schwer anzusteuern sind, jeweils mit einer vorgeschlagenen data-testid.
- **Assertions**: expect(...)-Zeilen für ein Element.
- **Session**: Elemente, die Sie auf mehreren Seiten benennen, exportiert als Page Object, als Markdown-Tabelle oder als JSON.
- **KI-Kontext**: ein Textblock, der ein Element beschreibt, für einen KI-Coding-Agenten.
- **Aufzeichnen**: Klicks, Eingaben und Auswahlen auf den Seiten einer Website, umgewandelt in einen TypeScript-Test. Passwörter werden nie aufgezeichnet.

**Standardmäßig privat**

Auswählen und Aufzeichnen nutzen nie das Netzwerk. Nichts wird gesammelt oder irgendwohin gesendet.

**Optional: Ihre eigene Piwi-Instanz verbinden**

Piwi ist ein selbst gehostetes Dashboard für Playwright-Testergebnisse. Ist die Erweiterung mit Ihrer Instanz verbunden (ihre URL und ein API-Schlüssel, in den Einstellungen), kommen drei Werkzeuge hinzu: Aufzeichnungen, die Ihre eigenen Testfunktionen aufrufen, **Testfunktionen**, das zeigt, welche davon auf der Seite funktionieren, und **Getestete Elemente**, das die Elemente hervorhebt, die Ihre Tests erreichen. Die Erweiterung liest Ihre Instanz und sendet ihr nur eines: einen Bug-Report, wenn Sie in der Vorschau, die genau zeigt, was gesendet wird, auf Senden klicken.

**Berechtigungen**

- Der Tab, den Sie gerade ansehen, nur wenn Sie auf den Button der Erweiterung klicken oder das Tastenkürzel drücken.
- Eine Website, erfragt, wenn Sie dort eine Aufzeichnung starten, damit der Recorder Ihnen von Seite zu Seite folgen kann. Bei der Installation wird nichts gewährt.
- Die Adresse Ihrer Piwi-Instanz, erfragt, wenn Sie eine Verbindung speichern.

Dokumentation (auf Englisch): [piwitests.dev/features/extension](https://piwitests.dev/features/extension)

Piwi ist nicht mit der Microsoft Corporation verbunden und wird von ihr weder unterstützt noch gefördert. Playwright ist eine Marke der Microsoft Corporation.
