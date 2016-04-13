require('should');

var immutable = require('immutable');

var repofs = require('../');

var ConflictUtils = require('../lib/utils/conflict');
var TreeEntry = require('../lib/models/treeEntry');
var TreeConflict = repofs.TreeConflict;
var Conflict = repofs.Conflict;
var WorkingState = repofs.WorkingState;

describe('ConflictUtils', function() {

    var parentEntries = new immutable.Map({
        bothDeleted: entry('bothDeleted'),
        bothModified:  entry('bothModified-parent'), // conflict
        deletedBase: entry('deletedBase'),
        // Deleted by base, modified by parent
        deletedModified: entry('deletedModified-parent'), // conflict
        modifiedBase:  entry('modifiedBase-parent'),
        unchanged:  entry('unchanged')
    });

    var baseEntries = new immutable.Map({
        addedBase: entry('addedBase'),
        bothAddedDifferent:  entry('bothAddedDifferent-base'), // conflict
        bothAddedSame:  entry('bothAddedSame'),
        bothModified:  entry('bothModified-base'), // conflict
        modifiedBase:  entry('modifiedBase-base'),
        unchanged:  entry('unchanged')
    });

    var headEntries = new immutable.Map({
        bothAddedDifferent:  entry('bothAddedDifferent-head'), // conflict
        bothAddedSame:  entry('bothAddedSame'),
        bothModified:  entry('bothModified-head'), // conflict
        deletedBase: entry('deletedBase'),
        deletedModified: entry('deletedModified-head'), // conflict
        modifiedBase:  entry('modifiedBase-parent'),
        unchanged:  entry('unchanged')
    });

    var parentWK = WorkingState.createWithTree('parentWK', parentEntries);
    var headWK = WorkingState.createWithTree('headWK', headEntries);
    var baseWK = WorkingState.createWithTree('baseWK', baseEntries);

    var CONFLICTS = {
        bothModified: new Conflict({
            parentSha: 'bothModified-parent',
            baseSha:   'bothModified-base',
            headSha:   'bothModified-head'
        }),
        bothAddedDifferent: new Conflict({
            parentSha: null,
            baseSha:  'bothAddedDifferent-base',
            headSha:  'bothAddedDifferent-head'
        }),
        deletedModified: new Conflict({
            parentSha: 'deletedModified-parent',
            baseSha:    null,
            headSha:   'deletedModified-head'
        })
    };

    var treeConflict = new TreeConflict({
        base: baseWK,
        head:headWK,
        parent: parentWK,
        conflicts: new immutable.Map(CONFLICTS)
    });

    // The list of solved conflicts, as returned after resolution
    var solvedConflicts = treeConflict.getConflicts().merge({
        bothModified: CONFLICTS.bothModified.solveWithContent('Solved content'),
        // bothAddedDifferent ignored, should default to keep base
        deletedModified: CONFLICTS.deletedModified.keepHead()
    });


    // ---- TESTS ----

    describe('._diffEntries', function() {

        it('should detect modified entries, added entries, and deleted entries', function() {
            var result = ConflictUtils._diffEntries(parentEntries, baseEntries);

            var expectedDiff = new immutable.Map({
                addedBase: entry('addedBase'),
                bothAddedDifferent: entry('bothAddedDifferent-base'),
                bothAddedSame: entry('bothAddedSame'),
                bothDeleted: null,
                bothModified: entry('bothModified-base'),
                deletedBase: null,
                deletedModified: null,
                modifiedBase: entry('modifiedBase-base')
            });

            immutable.is(result, expectedDiff).should.be.true();
        });

    });

    describe('._compareTrees', function() {

        it('should detect minimum set of conflicts', function() {
            var result = ConflictUtils._compareTrees(parentEntries, baseEntries, headEntries);
            var expected = treeConflict.getConflicts();

            immutable.is(result, expected).should.be.true();
        });

    });

    describe('.solveTree', function() {

        it('should merge back solved conflicts into a TreeConflict, defaulting to base version', function() {
            var solvedTreeConflict = ConflictUtils.solveTree(treeConflict, solvedConflicts);

            // Expect tree to be unchanged outside of conflicts
            immutable.is(solvedTreeConflict.set('conflicts', null),
                         treeConflict.set('conflicts', null));

            // Expect conflicts to be solved
            var expected = solvedConflicts.set('bothAddedDifferent',
                                      CONFLICTS.bothAddedDifferent.keepBase());
            var result = solvedTreeConflict.getConflicts();
            immutable.is(result, expected).should.be.true();
        });
    });

    describe('._getSolvedEntries', function() {

        it('should generate the solved tree entries', function() {
            var solvedTreeConflict = ConflictUtils.solveTree(treeConflict, solvedConflicts);
            var result = ConflictUtils._getSolvedEntries(solvedTreeConflict);

            var expected = new immutable.Map({
                deletedModified: entry('deletedModified-head'), // keeped head
                bothAddedSame: entry('bothAddedSame'),
                bothModified: entry(null), // solved with content
                addedBase: entry('addedBase'),
                bothAddedDifferent: entry('bothAddedDifferent-base'), // keeped base
                modifiedBase: entry('modifiedBase-base'),
                unchanged: entry('unchanged')
            });

            immutable.is(result, expected).should.be.true();
        });

    });

    describe('.mergeCommit', function() {
        var solvedTreeConflict = ConflictUtils.solveTree(treeConflict, solvedConflicts);
        var mergeCommit = ConflictUtils.mergeCommit(solvedTreeConflict, [
            'parentCommitSha1',
            'parentCommitSha2'
        ], {
            author: 'Shakespeare'
        });

        it('should create a merge CommitBuilder with two parents', function() {
            mergeCommit.getParents().toJS().should.eql([
                'parentCommitSha1',
                'parentCommitSha2'
            ]);
        });

        it('should create a merge CommitBuilder with an author', function() {
            mergeCommit.getAuthor().should.eql('Shakespeare');
        });

        it('should create a merge CommitBuilder with solved content as blob', function() {
            mergeCommit.getBlobs().get('bothModified').getAsString().should.eql('Solved content');
            mergeCommit.getBlobs().count().should.eql(1);
        });

        it('should create a merge CommitBuilder with final solved entries', function() {
            var solvedEntries = new immutable.Map({
                deletedModified: entry('deletedModified-head'), // keeped head
                bothAddedSame: entry('bothAddedSame'),
                bothModified: entry(null), // solved with content
                addedBase: entry('addedBase'),
                bothAddedDifferent: entry('bothAddedDifferent-base'), // keeped base
                modifiedBase: entry('modifiedBase-base'),
                unchanged: entry('unchanged')
            });

            immutable.is(mergeCommit.getTreeEntries(), solvedEntries).should.be.true();
        });
    });
});

// ---- Utils ----
function entry(sha) {
    return new TreeEntry({ sha: sha });
}

