/*!
    Online CloudFront Invalidator

    Author:  Seon-Wook Park
    Site:    http://www.swook.net/
    License: http://creativecommons.org/licenses/by-nc-sa/3.0/
 */

var cfInval = {
	checker: {
		init: function() {
			clearInterval(cfInval.checker.Timeout);
			if ($('#cf-invalidator .get .inprogress').length == 0) return;
			cfInval.checker.Timeout = setInterval(function() {
				if ($('#cf-invalidator .get .inprogress').length > 0)
					cfInval.getInvalidationList();
			}, 30000);
		},
		stop: function() {
			clearInterval(cfInval.checker.Timeout);
		}
	},
	invalidations: {},
	log: function(msg) {
		cfInvalUI.hermes.html(msg);
		cfInvalUI.hermes.css('color', 'green');
		cfInvalUI.hermes.css('background-image','url(http://cdn.swook.net/css/info.png)');
		cfInvalUI.showHermes();
	},
	error: function(msg) {
		cfInvalUI.hermes.html(msg);
		cfInvalUI.hermes.css('color', 'red');
		cfInvalUI.hermes.css('background-image','url(http://cdn.swook.net/css/alert.png)');
		cfInvalUI.showHermes();
	},
	loadAuth: function() {
		var auth = {};
		auth.enablesave = $.cookie('cfi_privacy');
		auth.enablesave = (auth.enablesave) ? true : false;
		auth.accesskey = $.cookie('cfi_accesskey');
		auth.secretkey = $.cookie('cfi_secretkey');
		auth.cache = JSON.parse($.cookie('cfi_cache'));
		cfInval.auth = auth;

		$('#cf-access > input').val(auth.accesskey);
		$('#cf-secret > input').val(auth.secretkey);

		if (auth.cache == null) cfInval.auth.cache = {};
		else {
			var latest;
			$.each(auth.cache, function(idx, val) {
				if (!latest) latest = val;
				else if (latest.lastTime < val.lastTime) latest = val
			});
			if (latest) $('#cf-distro > input').val(latest.ID);
			cfInval.populateDistroAutoComplete();
		}
	},
	saveAuth: function() {
		var auth = cfInval.auth;
		if (!auth.enablesave) return;
		$.cookie('cfi_privacy', '', {expires:-1, path: '/'});
		$.cookie('cfi_privacy', true, {expires:1000, path: '/'});
		$.cookie('cfi_accesskey', '', {expires:-1, path: '/'});
		$.cookie('cfi_accesskey', auth.accesskey, {expires:1000, path: '/'});
		$.cookie('cfi_secretkey', '', {expires:-1, path: '/'});
		$.cookie('cfi_secretkey', auth.secretkey, {expires:1000, path: '/'});
		$.cookie('cfi_cache', '', {expires:-1, path: '/'});
		$.cookie('cfi_cache', JSON.stringify(auth.cache), {expires:1000, path: '/'});
	},
	wipeAuth: function() {
		$.cookie('cfi_privacy', '', {expires:-1, path: '/'});
		$.cookie('cfi_accesskey', '', {expires:-1, path: '/'});
		$.cookie('cfi_secretkey', '', {expires:-1, path: '/'});
		$.cookie('cfi_cache', '', {expires:-1, path: '/'});
	},
	updateDistroInfo: function() {
		var distroid = $('#cf-distro > input').val();
		if (!distroid || distroid == '') return;
		if (!cfInval.auth.cache[distroid]) cfInval.auth.cache[distroid] = {ID: distroid, paths: [], pathsLastTime: []};
		if (cfInval.auth.cache[distroid].paths.length != cfInval.auth.cache[distroid].pathsLastTime.length) {
			cfInval.auth.cache[distroid].paths = [];
			cfInval.auth.cache[distroid].pathsLastTime = [];
		}
		cfInval.auth.cache[distroid].lastTime = new Date().getTime();
		cfInval.populateDistroAutoComplete();
	},
	populateDistroAutoComplete: function() {
		var distrolist = $('#distroid > select');
		distrolist.html('');
		$.each(cfInval.auth.cache, function(i, val) {
			if (i == 'undefined') delete cfInval.auth.cache[i];
			else distrolist.append('<option>'+val.ID+'</option>');
		});
		distrolist.off('change');
		distrolist.change(function() {
			$('#cf-distro > input').val($(this).val());
			if (cfInvalUI.currentPage == 1) cfInval.getInvalidationList();
			else if (cfInvalUI.currentPage == 2) cfInvalUI.submit.populatePastPaths();
		});

		var distroid = $('#cf-distro > input').val();
		if (distroid > '') {
			$('option', distrolist).each(function(i, elem) {
				if ($(elem).html() == distroid) $(elem).attr('selected', true);
			});
		}
	},
	dbDig: function(num) {
		if (num > 9) return num;
		else return '0'+num;
	},
	request: function(func, prop) {
		var a = $('#cf-access > input').val(),
			b = $('#cf-secret > input').val(),
			c = $('#cf-distro > input').val();
		if (a == '' || b == '' || c == '') {
			cfInval.error("Please fill in all details");
			return;
		}

		var aws = {};
		aws.url = 'https://cloudfront.amazonaws.com/2010-11-01/distribution/'+c+'/invalidation';
		if (prop && prop.urlTail) aws.url += prop.urlTail;
		aws.date = new Date().toUTCString();
		aws.auth = 'AWS '+a+':'+
				   btoa(hex2a(Crypto.HMAC(Crypto.SHA1, utf8Encode(aws.date), utf8Encode(b))));
		aws.method = (prop && prop.method) ? prop.method : 'GET';
		aws.yql = "USE 'http://cdn.swook.net/js/cfInval.xml' AS remote; "+
				  "SELECT * FROM remote WHERE url='"+
				  aws.url+"' AND meth='"+aws.method+"' AND auth='"+
				  aws.auth+"' AND date='"+aws.date+"'";
		if (aws.method == 'POST') aws.yql += " AND content='"+$.json2xml(prop.post,{rootTagName: 'InvalidationBatch'})+"'";
		cfInval.query(aws, func);
	},
	query: function(obj, func) {
		if (cfInval.querying) return;
		cfInval.querying = true;
		cfInval.log("Querying... Wait for this query to finish.");
		cfInvalUI.clicktrap.show();
		cfInvalUI.hermes.css('background-image','url(http://cdn.swook.net/css/loading.gif)');
		cfInvalUI.UI.css('cursor', 'progress');
		$.queryYQL(obj.yql, 'json', function(resp) {
			cfInval.querying = false;
			cfInval.log("Query Complete!");
			cfInvalUI.clicktrap.hide();
			cfInvalUI.UI.css('cursor', 'auto');
			console.log(resp);
			if (!resp || !resp.query.results) {
				cfInval.error("No Response. Try again in a moment.");
				func(null);
				return;
			}
			resp = resp.query.results;
			if (resp.result.status == '200' || resp.result.status == '201') {
				cfInval.auth.accesskey = $('#cf-access > input').val();
				cfInval.auth.secretkey = $('#cf-secret > input').val();
				cfInval.updateDistroInfo();
				cfInval.saveAuth();
				func(resp.result);
			}
			else if (resp.result.status == '400' && resp.result.html.TooManyInvalidationsInProgress)
				cfInval.error("Too Many Invalidations. Try later.");
			else if (resp.result.status == '403' && resp.result.html.InvalidSignatureException)
				cfInval.error("Invalid Signature. Check your access and secret key.");
			else if (resp.result.status == '404' && resp.result.html.NoSuchDistribution)
				cfInval.error("Invalid Distribution. Check your <a href='https://console.aws.amazon.com/cloudfront/home' target='_blank'>CloudFront Distribution ID</a>.");
			else if (resp.result.status == '503' && resp.result.html.ServiceUnavailableException)
				cfInval.error("CloudFront Invalidation Service Unavailable. Try again later.");
			else if (resp.result.status == '999')
				cfInval.error("Error contacting YQL Server. Try again later.");
			else
				cfInval.error("Status Code: "+resp.result.status+". Unknown Error: "+JSON.stringify(resp.result.html)+".");
		});
	},
	querying: false,
	get: function(func, prop) {
		cfInval.request(func, prop);
	},
	post: function(func, content) {
		cfInval.request(func, {
			method: 'POST',
			post: content
		});
	},
	getInvalidationList: function(marker) {
		var tail = '';
		if (marker) tail = '?Marker='+marker;
		clearTimeout(cfInval.getInvalidationListTimeout);
		cfInval.get(function(resp) {
			if (!resp) {
				cfInval.error("No response. Re-trying in 10 seconds...");
				cfInval.getInvalidationListTimeout = setTimeout(function() {
					if (cfInvalUI.currentPage == 1) cfInval.getInvalidationList(marker);
				}, 10000);
				return;
			}
			resp = resp.html.InvalidationList;
			if (!resp.InvalidationSummary) return;
			if (typeof resp.InvalidationSummary == 'object')
				resp.InvalidationSummary = [resp.InvalidationSummary];
			$('.inval', cfInvalUI.page).remove();
			var recursive = function(i, arr) {
				if (arr instanceof Array) $.each(arr, recursive);
				else if (typeof arr == 'object') cfInvalUI.get.addEntry(arr);
			}
			recursive(0, resp.InvalidationSummary);
			var id = $('.get .inval:first').attr('inval-id');
			if (cfInval.invalidations[id] && ((new Date().getTime())-cfInval.invalidations[id].lastTime < 10000))
				cfInvalUI.get.showInvalidation(id);
			//resp.IsTruncated == "true"
			//resp.Marker
			cfInval.checker.init();
		}, {urlTail: tail});
	},
	postInvalidation: function(files, ref) {
		if (!ref || ref == '') ref = new Date().toUTCString();
		var req = {
			Path: [],
			CallerReference: [ref]
		};
		for (var i = 0, len = files.length; i < len; i++)
			req.Path.push(files[i]);

		cfInval.post(function(resp) {
			if (!resp) {
				cfInval.error("There was no reply but it might have worked. Try refreshing the list.");
				return;
			}
			var iID = cfInval.parseInvalidation(resp), dID = $('#cf-distro > input').val(),
				time = new Date(cfInval.invalidations[iID].createTime).getTime(), idx;
			$.each(cfInval.invalidations[iID].paths, function(i, path) {
				idx = cfInval.auth.cache[dID].paths.indexOf(path);
				if (idx == -1) {
					cfInval.auth.cache[dID].paths.push(path);
					cfInval.auth.cache[dID].pathsLastTime.push(time);
				}
				else cfInval.auth.cache[dID].pathsLastTime[idx] = time;
			});
			if (cfInvalUI.currentPage == 2) cfInvalUI.initPage(1);
			else cfInval.getInvalidationList();
			$('#cf-pages').scrollTop(0);
		}, req);
	},
	getInvalidation: function(id) {
		if (cfInval.invalidations[id] && ((new Date().getTime())-cfInval.invalidations[id].lastTime < 10000)) {
			cfInval.error("Information was pulled less than 10 seconds ago.");
			return cfInvalUI.get.showInvalidation(id);
		}
		cfInval.get(function(resp) {
			if (!resp) return;
			cfInvalUI.get.showInvalidation(cfInval.parseInvalidation(resp));
		}, {urlTail: '/'+id});
	},
	parseInvalidation: function(resp) {
		resp = resp.html.Invalidation;
		if (typeof resp.InvalidationBatch.Path == 'string')
			resp.InvalidationBatch.Path = [resp.InvalidationBatch.Path];
		cfInval.invalidations[resp.Id] = {
			ID: resp.Id,
			status: resp.Status,
			callerReference: resp.InvalidationBatch.CallerReference,
			paths: resp.InvalidationBatch.Path,
			createTime: resp.CreateTime,
			lastTime: new Date().getTime()
		};
		if (resp.Status == 'Completed') {
			var curD = $('#cf-distro > input').val(), idx,
				time = new Date(cfInval.invalidations[resp.Id].createTime).getTime();
			$.each(resp.InvalidationBatch.Path, function(i, val) {
				if (!cfInval.checkPath(val).error) {
					idx = cfInval.auth.cache[curD].paths.indexOf(val);
					if (idx == -1) {
						cfInval.auth.cache[curD].paths.push(val);
						cfInval.auth.cache[curD].pathsLastTime.push(time);
					}
					else if (time > cfInval.auth.cache[curD].pathsLastTime[idx])
						cfInval.auth.cache[curD].pathsLastTime[idx] = time;
				}
			});
			cfInval.saveAuth();
		}
		return resp.Id;
	},
	checkPath: function(path) {
		var uri = cfInval.parseURL(path), error;
		if (uri.file == '') error = 'Directory';
		if (uri.relative == '/p'+cfInval.parseURL('/'+path).relative) uri.path = uri.path.slice(2);
		if (uri.path == '/p/cloudfront-invalidator.html') error = 'Invalid Entry';
		if ($('.currentpaths .path[path="'+uri.path+uri.query+'"]', cfInvalUI.page).length > 0)
			error = 'Duplicate Entry';
		return {
			path: (error) ? path : uri.path+uri.query,
			error: error
		};
	},
	parseURL: function(url) {
		var a =  document.createElement('a');
		a.href = url;
		return {
			source: url,
			protocol: a.protocol.replace(':',''),
			host: a.hostname,
			port: a.port,
			query: a.search,
			params: (function(){
				var ret = {},
					seg = a.search.replace(/^\?/,'').split('&'),
					len = seg.length, i = 0, s;
				for (;i<len;i++) {
					if (!seg[i]) { continue; }
					s = seg[i].split('=');
					ret[s[0]] = s[1];
				}
				return ret;
			})(),
			file: (a.pathname.match(/\/([^\/?#]+)$/i) || [,''])[1],
			hash: a.hash.replace('#',''),
			path: a.pathname.replace(/^([^\/])/,'/$1'),
			relative: (a.href.match(/tps?:\/\/[^\/]+(.+)/) || [,''])[1],
			segments: a.pathname.replace(/^\//,'').split('/')
		};
	}
};

var cfInvalUI = {
	init: function() {
		cfInvalUI.UI = $('#cf-invalidator');
		var ui = cfInvalUI.UI;
		ui.html('');
		cfInvalUI.initHermes(ui);
		cfInvalUI.initMessages(ui);
		cfInvalUI.initForm(ui);
		cfInvalUI.initPrivacy(ui);
		cfInvalUI.initTabs(ui);
	},
	stop: function() {
		cfInval.checker.stop();
		clearTimeout(cfInval.getInvalidationListTimeout);
		clearTimeout(cfInvalUI.messageTimeout);
		clearTimeout(cfInvalUI.hermesTimeout);
	},
	initHermes: function(ui) {
		ui.append($('<div id="cf-clicktrap"/><div id="hermes">Ready</div>'));
		cfInvalUI.clicktrap = $('#cf-clicktrap', ui);
		cfInvalUI.hermes = $('#hermes', ui);
		cfInvalUI.showHermes();
	},
	initMessages: function(ui) {
		ui.append($('<div id="cf-messages"><span class="title"/><span class="desc"/></div>'));
		cfInvalUI.messages = $('#cf-messages', ui);
		cfInvalUI.loadMessage();
	},
	initForm: function(ui) {
		ui.append($(
			'<div id="cf-form">'+
				'<div id="cf-access">'+
					'<span>Access Key ID</span>'+
					'<a href="https://aws-portal.amazon.com/gp/aws/developer/account/index.html?action=access-key#cred_block" target="_blank">Get It</a>'+
					'<input type="text" placeholder="Example: 0PN5J17HBGZHT7JJ3X82" tabindex="1"/>'+
				'</div>'+
				'<div id="cf-secret">'+
					'<span>Secret Access Key</span>'+
					'<a href="https://aws-portal.amazon.com/gp/aws/developer/account/index.html?action=access-key#cred_block" target="_blank">Get It</a>'+
					'<input type="password" placeholder="Example: /Ml61L9VxlzloZ091/lkqVV5X1/YvaJtI9hW4Wr9" tabindex="2"/>'+
				'</div>'+
				'<div id="cf-distro">'+
					'<span>Distribution ID</span>'+
					'<a href="https://console.aws.amazon.com/cloudfront/home" target="_blank">Get It</a>'+
					'<input list="distroid" type="text" placeholder="Example: E3GBU28YOG99FR" tabindex="3"/>'+
					'<datalist id="distroid"><select></select></datalist>'+
				'</div>'+
			'</div>'
		));
		cfInvalUI.form = $('#cf-form', ui);
	},
	initPrivacy: function(ui) {
		ui.append('<div id="cf-privacy"><b>Save credentials</b> <small><em>(Is this your PC?)</em></small><input type="checkbox"></div>');
		cfInvalUI.cbox = $('#cf-privacy input[type=checkbox]');
		cfInval.loadAuth();
		cfInvalUI.cbox[0].checked = cfInval.auth.enablesave;
		if (!cfInval.auth.enablesave) cfInval.wipeAuth();
		cfInvalUI.cbox.change(function() {
			if (!this.checked) {
				cfInval.auth.enablesave = false;
				cfInval.wipeAuth();
			} else {
				cfInval.auth.enablesave = true;
				cfInval.saveAuth();
			}
		});
	},
	initTabs: function(ui) {
		ui.append($('<div id="cf-tabs"></div>'));
		cfInvalUI.tabs = $('#cf-tabs', ui);
		cfInvalUI.tabs.append($('<span class="get">Get Invalidations</span>'));
		cfInvalUI.tabs.append($('<span class="submit">Submit Invalidation</span>'));
		$('.get', cfInvalUI.tabs).on('click', function() {
			cfInvalUI.initPage(1);
		});
		$('.submit', cfInvalUI.tabs).on('click', function() {
			cfInvalUI.initPage(2);
		});
		ui.append($('<div id="cf-pages"/>'));
		cfInvalUI.page = $('#cf-pages');
		cfInvalUI.initPage();
	},
	initPage: function(id) {
		if (!id) id = 1;
		else if (cfInvalUI.currentPage == id) return;
		cfInvalUI.clicktrap.css('cursor', 'progress');
		$('span', cfInvalUI.tabs).css('background-color', '#F1F1F1');
		if (id == 1) {
			cfInvalUI.page.html('');
			cfInvalUI.page.html(
				'<div class="instruction">Select an entry for more information.</div>'+
				'<div class="refresh">Refresh List</div>'+
				'<div class="get"/>'
			);
			$('.refresh', cfInvalUI.page).on('click', function() {
				cfInval.getInvalidationList();
			});
			$('.get', cfInvalUI.tabs).css('background-color', 'white');
			if ($('#cf-access > input').val() != '' && $('#cf-secret > input').val() != '' && $('#cf-distro > input').val() != '')
				cfInval.getInvalidationList();
		}
		else if (id == 2) {
			clearTimeout(cfInval.getInvalidationListTimeout);
			cfInval.checker.stop();
			cfInvalUI.page.html('');
			cfInvalUI.page.html(
				'<div class="post">'+
					'<div class="toolbar">'+
						'<div class="addall">Add All</div>'+
						'<div class="removeall">Remove All</div>'+
						'<div class="submit">Submit</div>'+
					'</div>'+
					'<div class="pastpaths">'+
						'<h2>Paths you used before</h2>'+
					'</div>'+
					'<div class="currentpaths">'+
						'<h2>Paths To Invalidate</h2>'+
					'</div>'+
				'</div>'
			);
			$('.submit', cfInvalUI.tabs).css('background-color', 'white');
			cfInvalUI.submit.initToolbar();
			cfInvalUI.submit.populatePastPaths();
			cfInvalUI.submit.newEntry();
		}
		cfInvalUI.currentPage = id;
		cfInvalUI.UI.css('cursor', 'auto');
	},
	get: {
		addEntry: function(obj) {
			var cl = obj.Status.toLowerCase();
			if (obj.Status == 'InProgress') obj.Status = 'In Progress';
			$('.get', cfInvalUI.page).append($(
				'<div class="inval '+cl+'" inval-id="'+obj.Id+'">'+
					'<span class="inval-ID" title="Invalidation ID">'+obj.Id+'</span>'+
					'<span class="inval-Status" title="Invalidation Status">'+obj.Status+'</span>'+
				'</div>'
			));
			var elem = $('.inval[inval-id="'+obj.Id+'"]', cfInvalUI.page),
				statuselem = $('span.inval-Status', elem);
			switch (obj.Status) {
				case 'In Progress':
					statuselem.css('color', 'red');
					break;
				case 'Completed':
					statuselem.css('color', 'green');
					break;
			}
			elem.on('click', function() {
				var $this = $(this), elem = $('table', $this);
				if (elem.length > 0) {
					elem.remove();
					$('.refresh', $this).remove();
					$('.resubmit', $this).remove();
				}
				else
					cfInval.getInvalidation($this.attr('inval-id'));
			});
		},
		showInvalidation: function(id) {
			var elem = $('.inval[inval-id='+id+']', cfInvalUI.page),
				info = cfInval.invalidations[id], statuselem = $('span.inval-Status', elem);
			$('.inval .refresh', cfInvalUI.page).remove();
			$('.inval table', cfInvalUI.page).remove();
			$('.inval .resubmit', cfInvalUI.page).remove();
			elem.addClass(info.status);
			switch(info.status) {
				case 'InProgress':
					statuselem.html('In Progress');
					statuselem.css('color', 'red');
					break;
				case 'Completed':
					statuselem.html('Completed');
					statuselem.css('color', 'green');
					break;
			}
			elem.append(
				'<div class="refresh" title="Refresh Information"/>'+
					'<table>'+
						'<tr>'+
							'<td><b>Paths</b></td>'+
							'<td><ul></ul></td>'+
						'</tr>'+
						'<tr>'+
							'<td><b>Created</b></td>'+
							'<td title="'+info.createTime+'"></td>'+
						'</tr>'+
						'<tr>'+
							'<td><b>Reference</b></td>'+
							'<td>'+info.callerReference+'</td>'+
						'</tr>'+
					'</table>'+
					'<div class="resubmit">Submit this Invalidation again</div>'+
				'</div>'
			);
			$('td[title="'+info.createTime+'"]', elem).timeago();
			$('table', elem).on('click', function(e) {
				e.stopPropagation();
			});
			$('.refresh', elem).on('click', function(e) {
				e.stopPropagation();
				cfInval.getInvalidation(id);
			});
			$('div.resubmit', elem).on('click', function(e) {
				e.stopPropagation();
				var tosubmit = [];
				$('li', elem).each(function(idx, item) {
					tosubmit.push(item.innerHTML);
				});
				cfInval.postInvalidation(tosubmit);
			});
			elem = $('ul', elem);
			$.each(info.paths, function(i, path) {
				if (i < 4) elem.append('<li>'+path+'</li>');
				else if (i == 4) {
					elem.append('<li class="showmore">Show More</li>');
					$('li.showmore', elem).on('click', function() {
						var $this = $(this);
						$('li.hidden', $this.parent()).removeClass('hidden');
						$this.remove();
					});
					elem.append('<li class="hidden">'+path+'</li>');
				}
				else elem.append('<li class="hidden">'+path+'</li>');
			});
		}
	},
	submit: {
		initToolbar: function() {
			var toolbar = $('.post .toolbar', cfInvalUI.page);
			$('.addall', toolbar).on('click', function() {
				$('.pastpaths .entry').trigger('click');
				cfInvalUI.submit.populatePastPaths();
			});
			$('.removeall', toolbar).on('click', function() {
				$('.currentpaths .path:not(.new-entry)').remove();
				cfInvalUI.submit.populatePastPaths();
			});
			$('.submit', toolbar).on('click', function() {
				var tosubmit = [];
				$('.currentpaths .path:not(.invalid, .new-entry)').each(function(i, div) {
					tosubmit.push($(div).attr('path'));
				});
				if (tosubmit.length == 0) return cfInval.error("Please add paths to invalidate");
				else cfInval.postInvalidation(tosubmit);
			});
		},
		populatePastPaths: function() {
			var curD = $('#cf-distro > input').val(),
				elem = $('.pastpaths', cfInvalUI.page);
			$('div', elem).remove();
			if (curD == '' || !(curD in cfInval.auth.cache) || cfInval.auth.cache[curD].paths.length == 0) {
				$('h2', elem).hide();
				return;
			}
			$.each(cfInval.auth.cache[curD].paths, function(i, path) {
				if ($('.currentpaths .path[path="'+path+'"]', cfInvalUI.page).length > 0) return;
				elem.append($(
					'<div class="entry" path="'+path+'" lastTime="'+cfInval.auth.cache[curD].pathsLastTime[i]+'">'+
						path+
						'<span class="timeago">'+
							$.timeago(new Date(cfInval.auth.cache[curD].pathsLastTime[i]))+
						'</span>'+
					'</div>'
				));
			});
			if ($('div', elem).length == 0) $('h2', elem).hide();
			else {
				$('h2', elem).show();
				$('.entry', elem).sortElements(function(a, b) {
					return parseInt($(b).attr('lastTime'))-parseInt($(a).attr('lastTime'));
				}).each(function(i, div) {
					$(div).on('click', cfInvalUI.submit.addEntryFromPast);
				});
			}
		},
		newEntry: function() {
			$('.currentpaths .new-entry', cfInvalUI.page).removeClass('new-entry');
			var elem = $('.new-entry', $('.currentpaths', cfInvalUI.page).append($(
				'<div class="path new-entry">'+
					'<input type="text" placeholder="Enter Path"/>'+
					'<span class="add">Add Path</span>'+
					'<span class="error"/>'+
				'</div>'
			)));
			$('input', elem).on('paste', function() {
				var input = $(this);
				setTimeout(function() {
					var paths = input.val().split(/\r\n|\n/);
					$.each(paths, function(i, path) {
						if (i == paths.length-1) $('.currentpaths input:enabled', cfInvalUI.page).val(path);
						else {
							$('.currentpaths input:enabled', cfInvalUI.page).val(path);
							cfInvalUI.submit.addEntry();
						}
					});
				}, 100);
			}).keydown(function(e) {
				if (e.keyCode != 13 && e.keyCode != 9) return;
				e.preventDefault();
				cfInvalUI.submit.addEntry();
			}).focus();
			$('span.add', elem).on('click', function(e) {
				e.stopPropagation();
				cfInvalUI.submit.addEntry();
			});
		},
		addEntry: function() {
			var elem = $('.currentpaths input:enabled', cfInvalUI.page),
				entry = elem.parent(),
				text = elem.val();
			if (text == '') return;
			var pchk = cfInval.checkPath(text);
			if (text.indexOf('*') > -1) {
				var count = 0, re = new RegExp('^'+text.replace(/\./g,'\.').replace(/\*/g,'.*')+'$');
				$('.pastpaths .entry', cfInvalUI.page).each(function(i, e) {
					var $e = $(e);
					if ($e.attr('path').match(re)) {
						$e.click();
						count++;
					}
				});
				if (count > 0) return $('.currentpaths input:enabled').val('');
				else pchk.error = 'No matches from history';
			}
			cfInvalUI.submit.disableEntry(elem, entry, pchk.path);
			if (pchk.error > '') {
				$('span.error', entry).html(pchk.error);
				entry.addClass('invalid');
			}
			else $('.pastpaths .entry[path="'+pchk.path+'"]', cfInvalUI.page).remove();
			cfInvalUI.submit.newEntry();
		},
		disableEntry: function(input, entry, path) {
			input.attr('disabled', 'disabled').val(path);
			entry.prepend($('<img class ="delete" title="Remove Path" src="http://cdn.swook.net/css/delete.png"/>'));
			$('.delete', entry).on('click', function(e) {
				$(this).parent().remove();
				cfInvalUI.submit.populatePastPaths();
			})
			entry.attr('path', path);
		},
		addEntryFromPast: function() {
			var path = $(this).attr('path'),
				elem = $('.currentpaths input:enabled', cfInvalUI.page),
				entry = elem.parent(),
				cache = elem.val();
			cfInvalUI.submit.disableEntry(elem, entry, path);
			$('.pastpaths .entry[path="'+path+'"]', cfInvalUI.page).remove();
			cfInvalUI.submit.newEntry();
			if (cache > '') $('.currentpaths input:enabled').val(cache);
		}
	},
	showHermes: function() {
		if (cfInvalUI.hermesTimeout)
			clearTimeout(cfInvalUI.hermesTimeout);
		cfInvalUI.hermesTimeout = setTimeout(function() {
			if (cfInval.querying) return cfInvalUI.showHermes();
			cfInvalUI.hermes.html('<b>Online CloudFront Invalidator</b> <i><small>by <a href="/p/about.html"">Seon-Wook Park</a></small></i>');
			cfInvalUI.hermes.css('color', 'black');
			cfInvalUI.hermes.css('background-image','none');
			$('a', cfInvalUI.hermes).each($.Ajaxify.applyTo);
		}, 6000);
	},
	messageList: [
		{
			title: "Welcome",
			desc: "I hope you enjoy using the Online CloudFront Invalidator. This app is a safe and easy way of invalidating your CloudFront files."
		},
		{
			title: "Secure",
			desc: "This is probably the most secure invalidator. Your access and secret key are not leaked anywhere and all requests are done via HTTPS."
		},
		{
			title: "Invalidations",
			desc: "Note that invalidations take around 15-20 minutes to complete. Check if you have requested one before requesting a new one!"
		},
		{
			title: "JavaScript = Fast &amp; Secure",
			desc: "This app will never slow down because of the number of users. I will also never receive any AWS data from you."
		},
		{
			title: "Any Problems?",
			desc: "If you experienced any issues with this app, comment below or <a href='mailto:seon.wook@swook.net'>send me an e-mail</a>!"
		},
		{
			title: "Support Me",
			desc: "If you liked my app, please share this page with your friends and co-workers. It would really be appreciated!"
		}
	],
	loadMessage: function() {
		if (cfInvalUI.messageCurrent == null || cfInvalUI.messageCurrent >= (cfInvalUI.messageList.length-1))
			cfInvalUI.messageCurrent = 0;
		else cfInvalUI.messageCurrent++;
		$('span.title', cfInvalUI.messages).html(cfInvalUI.messageList[cfInvalUI.messageCurrent].title);
		$('span.desc', cfInvalUI.messages).html(cfInvalUI.messageList[cfInvalUI.messageCurrent].desc);
		$('a[target!=blank_]', cfInvalUI.messages).each($.Ajaxify.applyTo)
		cfInvalUI.messageTimeout = setTimeout(cfInvalUI.loadMessage, 25000);
	},
};


/*
 * Third Party Scripts
 */


// From Klaus Hartl
// ref. https://github.com/carhartl/jquery-cookie
$.cookie = function(key, value, options) {

	// key and at least value given, set cookie...
	if (arguments.length > 1 && (!/Object/.test(Object.prototype.toString.call(value)) || value === null || value === undefined)) {
		options = $.extend({}, options);

		if (value === null || value === undefined) {
			options.expires = -1;
		}

		if (typeof options.expires === 'number') {
			var days = options.expires, t = options.expires = new Date();
			t.setDate(t.getDate() + days);
		}

		value = String(value);

		return (document.cookie = [
			encodeURIComponent(key), '=', options.raw ? value : encodeURIComponent(value),
			options.expires ? '; expires=' + options.expires.toUTCString() : '', // use expires attribute, max-age is not supported by IE
			options.path    ? '; path=' + options.path : '',
			options.domain  ? '; domain=' + options.domain : '',
			options.secure  ? '; secure' : ''
		].join(''));
	}

	// key and possibly options given, get cookie...
	options = value || {};
	var decode = options.raw ? function(s) { return s; } : decodeURIComponent;

	var pairs = document.cookie.split('; ');
	for (var i = 0, pair; pair = pairs[i] && pairs[i].split('='); i++) {
		if (decode(pair[0]) === key) return decode(pair[1] || ''); // IE saves cookies with empty string as "c; ", e.g. without "=" as opposed to EOMB, thus pair[1] may be undefined
	}
	return null;
};



// From James Padolsey
// ref. http://james.padolsey.com/javascript/sorting-elements-with-jquery/
jQuery.fn.sortElements = (function(){

    var sort = [].sort;

    return function(comparator, getSortable) {

        getSortable = getSortable || function(){return this;};

        var placements = this.map(function(){

            var sortElement = getSortable.call(this),
                parentNode = sortElement.parentNode,

                // Since the element itself will change position, we have
                // to have some way of storing its original position in
                // the DOM. The easiest way is to have a 'flag' node:
                nextSibling = parentNode.insertBefore(
                    document.createTextNode(''),
                    sortElement.nextSibling
                );

            return function() {

                if (parentNode === this) {
                    throw new Error(
                        "You can't sort elements if any one is a descendant of another."
                    );
                }

                // Insert before flag:
                parentNode.insertBefore(this, nextSibling);
                // Remove flag:
                parentNode.removeChild(nextSibling);

            };

        });

        return sort.call(this, comparator).each(function(i){
            placements[i].call(getSortable.call(this));
        });

    };

})();


// From Ali Farhadi
// ref. http://farhadi.ir/works/utf8

chr = function(code)
{
	return String.fromCharCode(code);
};

//returns utf8 encoded charachter of a unicode value.
//code must be a number indicating the Unicode value.
//returned value is a string between 1 and 4 charachters.
code2utf = function(code)
{
	if (code < 128) return chr(code);
	if (code < 2048) return chr(192+(code>>6)) + chr(128+(code&63));
	if (code < 65536) return chr(224+(code>>12)) + chr(128+((code>>6)&63)) + chr(128+(code&63));
	if (code < 2097152) return chr(240+(code>>18)) + chr(128+((code>>12)&63)) + chr(128+((code>>6)&63)) + chr(128+(code&63));
};

//it is a private function for internal use in utf8Encode function
_utf8Encode = function(str)
{
	var utf8str = new Array();
	for (var i=0; i<str.length; i++) {
			utf8str[i] = code2utf(str.charCodeAt(i));
	}
	return utf8str.join('');
};

//Encodes a unicode string to UTF8 format.
utf8Encode = function(str)
{
	var utf8str = new Array();
	var pos,j = 0;
	var tmpStr = '';

	while ((pos = str.search(/[^\x00-\x7F]/)) != -1) {
			tmpStr = str.match(/([^\x00-\x7F]+[\x00-\x7F]{0,10})+/)[0];
			utf8str[j++] = str.substr(0, pos);
			utf8str[j++] = _utf8Encode(tmpStr);
			str = str.substr(pos + tmpStr.length);
	}

	utf8str[j++] = str;
	return utf8str.join('');
};

function hex2a(hex) {
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

cfInvalUI.init();