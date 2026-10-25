package app.pocket.tracker;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FileNamesTest {
    @Test
    public void acceptsPlainBackupNames() {
        assertTrue(FileNames.isSafe("pocket-backup-2026-10-22.json"));
        assertTrue(FileNames.isSafe("backup_1.json"));
    }

    @Test
    public void refusesNamesThatCouldPointElsewhere() {
        assertFalse(FileNames.isSafe("../secret.json"));
        assertFalse(FileNames.isSafe("folder/file.json"));
        assertFalse(FileNames.isSafe("a\\b.json"));
        assertFalse(FileNames.isSafe(".hidden"));
        assertFalse(FileNames.isSafe(""));
        assertFalse(FileNames.isSafe(null));
        assertFalse(FileNames.isSafe("with space.json"));
        assertFalse(FileNames.isSafe("x".repeat(81)));
    }
}
