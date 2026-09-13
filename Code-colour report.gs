// ======== CONFIG ========
const PARENT_FOLDER_ID = '1FaGXd0B72-Gj3Ql-2B7QQbn1C8b9AECQ';
const DUPLICATE_FILE_COLOR = '#FFF59D';   // yellow background
const DUPLICATE_FOLDER_COLOR = '#A5D6A7'; // green background

// Text colors used to distinguish nesting depth (cycles if deeper than this list)
const DEPTH_COLORS = ['#1A73E8', '#8E24AA', '#E67C00', '#00897B', '#546E7A'];
// =========================

function runFolderAudit() {
  const parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);

  const allItems = [];    // flat list of { path, name, type, size, id }
  const treeEntries = []; // [{ id, type, name, depth, text }]

  // Kick off recursive walk
  walkFolder(parentFolder, parentFolder.getName(), 0, allItems, treeEntries);

  // Analyze
  const duplicateFiles = findDuplicateFiles(allItems);
  const duplicateFolders = findSimilarFolders(allItems);
  const recommendations = buildRecommendations(duplicateFiles, duplicateFolders, allItems);

  // Build sets of IDs to highlight
  const duplicateFileIds = new Set();
  duplicateFiles.forEach(group => group.forEach(item => duplicateFileIds.add(item.id)));

  const duplicateFolderIds = new Set();
  duplicateFolders.forEach(group => group.forEach(item => duplicateFolderIds.add(item.id)));

  // Build report doc
  createReportDoc(parentFolder.getName(), treeEntries, duplicateFiles, duplicateFolders,
    recommendations, duplicateFileIds, duplicateFolderIds, allItems);
}

/**
 * Recursively walk a folder, collecting items and building tree entries.
 */
function walkFolder(folder, path, depth, allItems, treeEntries) {
  const indent = '  '.repeat(depth);

  treeEntries.push({
    id: folder.getId(),
    type: 'folder',
    name: folder.getName(),
    depth: depth,
    text: indent + '📁 ' + folder.getName()
  });

  allItems.push({
    path: path,
    name: folder.getName(),
    type: 'folder',
    size: null,
    id: folder.getId()
  });

  // Files in this folder
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileIndent = '  '.repeat(depth + 1);

    treeEntries.push({
      id: file.getId(),
      type: 'file',
      name: file.getName(),
      depth: depth + 1,
      text: fileIndent + '📄 ' + file.getName() + ' (' + formatBytes(file.getSize()) + ')'
    });

    allItems.push({
      path: path + '/' + file.getName(),
      name: file.getName(),
      type: 'file',
      size: file.getSize(),
      id: file.getId()
    });
  }

  // Recurse into subfolders
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    walkFolder(sub, path + '/' + sub.getName(), depth + 1, allItems, treeEntries);
  }
}

/**
 * Find files that share the same name (case-insensitive), grouped.
 */
function findDuplicateFiles(allItems) {
  const filesByName = {};
  allItems
    .filter(item => item.type === 'file')
    .forEach(item => {
      const key = normalizeName(item.name);
      if (!filesByName[key]) filesByName[key] = [];
      filesByName[key].push(item);
    });

  const duplicates = [];
  for (const key in filesByName) {
    if (filesByName[key].length > 1) {
      duplicates.push(filesByName[key]);
    }
  }
  return duplicates;
}

/**
 * Find folders with similar/near-duplicate names,
 * e.g. "Invoices", "Invoices copy", "Invoices 2", "Invoices_old"
 */
function findSimilarFolders(allItems) {
  const folders = allItems.filter(item => item.type === 'folder');
  const groups = {};

  folders.forEach(folder => {
    const base = stripSuffixNoise(folder.name);
    const key = normalizeName(base);
    if (!groups[key]) groups[key] = [];
    groups[key].push(folder);
  });

  const similarGroups = [];
  for (const key in groups) {
    if (groups[key].length > 1) {
      similarGroups.push(groups[key]);
    }
  }
  return similarGroups;
}

/**
 * Strip common "copy/duplicate/versioned" suffixes so we can group
 * "Invoices", "Invoices copy", "Invoices (1)", "Invoices_old", "Invoices 2" together.
 */
function stripSuffixNoise(name) {
  return name
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/\s*-?\s*copy(\s*\d*)?\s*$/i, '')
    .replace(/\s*_?old\s*$/i, '')
    .replace(/\s*_?backup\s*$/i, '')
    .replace(/\s*\d+\s*$/i, '')
    .trim();
}

function normalizeName(name) {
  return name.toLowerCase().trim();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

/**
 * Build plain-English recommendations based on findings.
 */
function buildRecommendations(duplicateFiles, duplicateFolders, allItems) {
  const recs = [];

  if (duplicateFiles.length > 0) {
    recs.push(
      duplicateFiles.length + ' set(s) of files share the same name across different locations (highlighted yellow in the tree). ' +
      'Review these and delete or consolidate the redundant copies to save space and avoid confusion.'
    );
  } else {
    recs.push('No duplicate file names were found. File organization looks clean on that front.');
  }

  if (duplicateFolders.length > 0) {
    recs.push(
      duplicateFolders.length + ' group(s) of folders appear to be near-duplicates (highlighted green in the tree), e.g. "Invoices" vs ' +
      '"Invoices copy" vs "Invoices 2". Consider merging their contents into a single folder and removing the extras.'
    );
  } else {
    recs.push('No near-duplicate folder names were found.');
  }

  const totalFolders = allItems.filter(i => i.type === 'folder').length;
  const totalFiles = allItems.filter(i => i.type === 'file').length;
  const avgDepth = allItems.reduce((sum, i) => sum + i.path.split('/').length, 0) / allItems.length;

  if (avgDepth > 6) {
    recs.push('The folder structure is quite deep on average. Consider flattening some nested folders to make files easier to find.');
  }

  recs.push('Total scanned: ' + totalFolders + ' folders and ' + totalFiles + ' files.');

  return recs;
}

/**
 * Create the final Google Doc report.
 */
function createReportDoc(rootName, treeEntries, duplicateFiles, duplicateFolders, recommendations,
                          duplicateFileIds, duplicateFolderIds, allItems) {
  const doc = DocumentApp.create('Drive Audit Report - ' + rootName + ' - ' + new Date().toDateString());
  const body = doc.getBody();

  body.appendParagraph('Drive Folder Audit Report').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Root folder: ' + rootName);
  body.appendParagraph('Generated: ' + new Date().toString());

  // --- Plain-English summary, up top for non-technical readers ---
  const totalFolders = allItems.filter(i => i.type === 'folder').length;
  const totalFiles = allItems.filter(i => i.type === 'file').length;
  body.appendParagraph('Quick Summary').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(
    'This folder contains ' + totalFolders + ' subfolder(s) and ' + totalFiles + ' file(s) in total. ' +
    'We found ' + duplicateFiles.length + ' set(s) of duplicate files and ' +
    duplicateFolders.length + ' group(s) of duplicate-looking folders. See the color key and tree below.'
  );

  // --- Legend ---
  body.appendParagraph('How to Read the Tree Below').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const legendBold = body.appendParagraph('  Bold, larger text = top-level folder (main category)');
  legendBold.editAsText().setBold(true).setFontSize(13);
  DEPTH_COLORS.slice(0, 2).forEach((color, i) => {
    const p = body.appendParagraph('  This color = nesting level ' + (i + 1) + ' deep');
    p.editAsText().setForegroundColor(color);
  });
  const legendFile = body.appendParagraph('  Yellow background = duplicate file name found elsewhere');
  legendFile.editAsText().setBackgroundColor(DUPLICATE_FILE_COLOR);
  const legendFolder = body.appendParagraph('  Green background = duplicate / near-duplicate folder');
  legendFolder.editAsText().setBackgroundColor(DUPLICATE_FOLDER_COLOR);

  // --- Tree section (one paragraph per line, styled by depth + highlighted for duplicates) ---
  body.appendParagraph('Folder Tree').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  treeEntries.forEach(entry => {
    const para = body.appendParagraph(entry.text);
    const text = para.editAsText();
    text.setFontFamily('Courier New');

    if (entry.depth === 0) {
      // Top-level folders: bold and bigger so they stand out as main categories
      text.setBold(true);
      text.setFontSize(13);
    } else {
      // Color-code by depth so the hierarchy is visible without counting indents
      const colorIndex = (entry.depth - 1) % DEPTH_COLORS.length;
      text.setForegroundColor(DEPTH_COLORS[colorIndex]);
      text.setFontSize(11);
    }

    // Duplicate highlighting takes priority as a background color, on top of the text color
    if (entry.type === 'file' && duplicateFileIds.has(entry.id)) {
      text.setBackgroundColor(DUPLICATE_FILE_COLOR);
    } else if (entry.type === 'folder' && duplicateFolderIds.has(entry.id)) {
      text.setBackgroundColor(DUPLICATE_FOLDER_COLOR);
    }
  });

  // --- Duplicates section ---
  body.appendParagraph('Duplicate Files').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (duplicateFiles.length === 0) {
    body.appendParagraph('None found.');
  } else {
    duplicateFiles.forEach(group => {
      body.appendParagraph(group[0].name + ' (' + group.length + ' copies)').setHeading(DocumentApp.ParagraphHeading.HEADING3);
      group.forEach(item => {
        const p = body.appendParagraph('  • ' + item.path);
        p.editAsText().setBackgroundColor(DUPLICATE_FILE_COLOR);
      });
    });
  }

  body.appendParagraph('Duplicate / Similar Folders').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (duplicateFolders.length === 0) {
    body.appendParagraph('None found.');
  } else {
    duplicateFolders.forEach(group => {
      body.appendParagraph('Similar group: ' + group.map(g => g.name).join(', ')).setHeading(DocumentApp.ParagraphHeading.HEADING3);
      group.forEach(item => {
        const p = body.appendParagraph('  • ' + item.path);
        p.editAsText().setBackgroundColor(DUPLICATE_FOLDER_COLOR);
      });
    });
  }

  // --- Recommendations ---
  body.appendParagraph('Recommendations').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  recommendations.forEach(rec => {
    body.appendParagraph('• ' + rec);
  });

  doc.saveAndClose();
  Logger.log('Report created: ' + doc.getUrl());
}
